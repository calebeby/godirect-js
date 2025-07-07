/* eslint-disable no-bitwise */
import { commands, measurementType, responseType } from "./constants.js";
import {
  bufferToHex,
  appendBuffer,
  log,
  dir,
  EventEmitter,
  nonZero,
} from "./utils.js";

import { Sensor, MeasurementInfo, SensorSpecs } from "./Sensor.js";
import WebUsbDeviceAdapter from "./WebUsbDeviceAdapter.js";
import WebBluetoothDeviceAdapter from "./WebBluetoothDeviceAdapter.js";

export default class Device extends EventEmitter<{
  "measurements-started": void;
  "measurements-stopped": void;
  "device-opened": void;
  "device-closed": void;
}> {
  device: WebUsbDeviceAdapter | WebBluetoothDeviceAdapter;
  sensors: Sensor[];
  opened: boolean;
  rollingCounter: number;
  collecting: boolean;
  measurementPeriod: number;
  response: DataView | null;
  remainingResponseLength: number;
  defaultSensorsMask: number;
  keepValues: boolean;
  minMeasurementPeriod: number;
  serialNumber: string;
  orderCode: string;
  name: string;
  writeQueue: {
    command: number;
    rollingCounter: number;
    buffer: Uint8Array;
    written: boolean;
    resolve: (data: DataView) => void;
    reject: (error: unknown) => void;
  }[] = [];
  deviceWriteInterval: number | undefined;
  availableSensors = 0;

  constructor(device: WebUsbDeviceAdapter | WebBluetoothDeviceAdapter) {
    super();

    this.device = device;
    this.sensors = [];
    this.opened = false;
    this.rollingCounter = 0;
    this.collecting = false;
    this.measurementPeriod = 10; // milliseconds
    this.response = null;
    this.remainingResponseLength = 0;
    this.defaultSensorsMask = 0;
    this.keepValues = true; // keep all the values during a collection
    this.minMeasurementPeriod = 10; // minimum period in milliseconds

    this.serialNumber = "";
    this.orderCode = "";
    this.name = "";
  }

  /** Returns a percentage of battery remaining */
  async getBatteryLevel(): Promise<number> {
    const status = await this.#getStatus();
    return status.battery;
  }

  /**
   * Returns the battery charging state. See constants.js for defined charging states
   */
  async getChargingState() {
    const status = await this.#getStatus();
    return status.chargingStatus;
  }

  /**
   * Open the device and get information
   * @name open
   * @param autoStart if set to true the device enables default sensors and starts measurements.
   */
  async open(autoStart = false) {
    if (this.opened) {
      throw new Error(`Device cannot be opened because it is already open`);
    }
    await this.#connect();
    await this.#init();
    await this.#getStatus();
    await this.#getDefaultSensorsMask();
    await this.#getAvailableSensors();
    await this.#getDeviceInfo();

    this.#onOpened();

    if (autoStart) {
      this.start();
    }
  }

  /**
   * Close the device, stop measurements and send the disconnect.
   * @name close
   */
  async close() {
    if (!this.opened) {
      throw new Error(`Device cannot be closed because it is not open`);
    }
    await this.stopMeasurements();
    await this.sendCommand(commands.DISCONNECT);
    return this.disconnect();
  }

  /**
   * Enable the default sensors specified by the device.
   * @name enableDefaultSensors
   */
  enableDefaultSensors() {
    let mask = 1;

    for (let i = 0; i < 32; ++i) {
      if ((this.defaultSensorsMask & mask) === mask) {
        const sensor = this.getSensor(i);
        if (sensor) {
          sensor.setEnabled(true);
        }
      }
      mask <<= 1;
    }
  }

  /**
   * Start measurements on the enabled sensors. If no sensors are enabled
   * then enable the default sensors. If a period is specified then use it,
   * if not use the fastest typical from the enabled sensors.
   */
  start(period: number | null = null) {
    let enabledSensors = this.sensors.filter((s) => s.enabled);

    // And make sure at least one sensor is enabled.
    if (enabledSensors.length === 0) {
      this.enableDefaultSensors();
      enabledSensors = this.sensors.filter((s) => s.enabled);
    }

    // Clear out the last collection's values.
    enabledSensors.forEach((s) => s.clear());

    // If the user passed in a period then use it
    if (period) {
      this.measurementPeriod = period;
    }

    this.startMeasurements();
  }

  /**
   * Stop measurements on the device.
   * @name stop
   */
  stop() {
    this.stopMeasurements();
  }

  /** Based on a number return the sensor. */
  getSensor(number: number) {
    return this.sensors.find((c) => c.number === number);
  }

  async #connect() {
    return this.device
      .setup({
        onClosed: () => this.#onClosed(),
        onResponse: (data) => this.#handleResponse(data),
      })
      .then(() => {
        this.writeQueue = [];

        // Enforce that only one command is set to the device at once
        // and nothing else is sent until the response or timeout happens.
        this.deviceWriteInterval = setInterval(() => {
          if (this.writeQueue && this.writeQueue.length > 0) {
            const q = this.writeQueue[0];
            if (!q.written) {
              this.#writeToDevice(q.buffer);
              q.written = true;
            }
          }
        }, 10) as any as number;
      });
  }

  async disconnect() {
    // Clear out the interval because we only need it when connected.
    clearInterval(this.deviceWriteInterval);

    return this.device.close();
  }

  #init() {
    this.collecting = false;
    this.rollingCounter = 0xff;

    return this.sendCommand(commands.INIT);
  }

  #handleResponse(notification: DataView) {
    // log(`command notified: ${bufferToHex(notification.buffer)}`);

    // If we flagged that we are looking for more data then just pull off more
    if (this.remainingResponseLength > 0) {
      this.remainingResponseLength -= notification.buffer.byteLength;
      this.response = new DataView(
        appendBuffer(this.response!.buffer, notification.buffer.slice(0)),
      );
      if (this.remainingResponseLength > 0) {
        return;
      }
    } else {
      this.response = notification;
    }

    const resLength = this.response.getUint8(1);
    if (resLength > this.response.buffer.byteLength) {
      this.remainingResponseLength =
        resLength - this.response.buffer.byteLength;
      return;
    }

    log(`handle command: ${bufferToHex(this.response.buffer)}`);

    const resType = this.response.getUint8(0);
    switch (resType) {
      case responseType.MEASUREMENT:
        this.#processMeasurements(this.response);
        break;
      default: {
        const resCommand = this.response.getUint8(4);
        const resRollingCounter = this.response.getUint8(5);
        const resPacket = new DataView(this.response.buffer, 6);

        this.#resolveWriteCommand(resCommand, resRollingCounter, resPacket);
        this.remainingResponseLength = 0;
        this.response = null;
        break;
      }
    }
  }

  #getSensorsWithMask(channelMask: number) {
    const sensors = [];
    let mask = 1;

    for (let i = 0; i < 32; ++i) {
      if ((channelMask & mask) === mask) {
        const sensor = this.getSensor(i);
        if (sensor) {
          sensors.push(sensor);
        }
      }
      mask <<= 1;
    }
    return sensors;
  }

  #processMeasurements(response: DataView) {
    let sensors: Sensor[] = [];
    let isFloat = true;
    let valueCount = 0;
    let index = 0;

    const type = response.getUint8(4);
    switch (type) {
      case measurementType.NORMAL_REAL32: {
        sensors = this.#getSensorsWithMask(response.getUint16(5, true));
        valueCount = response.getUint8(7);
        index = 9;
        break;
      }
      case measurementType.WIDE_REAL32: {
        sensors = this.#getSensorsWithMask(response.getUint32(5, true));
        valueCount = response.getUint8(9);
        index = 11;
        break;
      }
      case measurementType.APERIODIC_REAL32:
      case measurementType.SINGLE_CHANNEL_REAL32: {
        sensors[0] = this.getSensor(response.getUint8(6))!;
        valueCount = response.getUint8(7);
        index = 8;
        break;
      }
      case measurementType.APERIODIC_INT32:
      case measurementType.SINGLE_CHANNEL_INT32: {
        sensors[0] = this.getSensor(response.getUint8(6))!;
        valueCount = response.getUint8(7);
        index = 8;
        isFloat = false;
        break;
      }
      case measurementType.START_TIME:
      case measurementType.DROPPED:
      case measurementType.PERIOD: {
        log(`Purposely Ignoring packet type: ${type}`);
        break;
      }
      default:
        log(`Unknown packet type: ${type}`);
    }

    for (let count = 0; count < valueCount; ++count) {
      for (let ix = 0; ix < sensors.length; ++ix) {
        if (isFloat) {
          sensors[ix].setValue(
            response.getFloat32(index, true),
            this.keepValues,
          );
        } else {
          sensors[ix].setValue(response.getInt32(index, true), this.keepValues);
        }
        index += 4;
      }
    }
  }

  #resolveWriteCommand(
    command: number,
    rollingCounter: number,
    response: DataView,
  ) {
    const item = this.writeQueue.find(
      (q) => q.command === command && q.rollingCounter === rollingCounter,
    );

    if (item) {
      item.resolve(response);
      this.writeQueue = this.writeQueue.filter((q) => q !== item);
    }
  }

  #onOpened() {
    log("opened");
    this.opened = true;
    this.emit("device-opened");
  }

  #onClosed() {
    log("closed");
    this.opened = false;
    this.emit("device-closed");
  }

  #decRollingCounter() {
    // this.rollingCounter -= 1;
    // return this.rollingCounter;

    // The version above is what is in the godirect-js repo.
    // The device itself doesn't seem to care whether the decrement is before or after it is sent
    // (though the sent command is different).
    // I changed this to decrement after sending to make the commands identical to the native lib (I think)
    return this.rollingCounter--;
  }

  #calculateChecksum(buff: Uint8Array) {
    const length = buff[1];
    let checksum = -1 * buff[3];

    for (let i = 0; i < length; ++i) {
      checksum += buff[i];
      checksum &= 0xff;
    }

    if (checksum < 0 || checksum > 255) {
      log("Checksum failed!");
      return 0;
    }

    return checksum;
  }

  sendCommand(subCommand: Uint8Array) {
    const command = new Uint8Array(
      commands.HEADER.byteLength + subCommand.byteLength,
    );
    command.set(commands.HEADER, 0);
    command.set(subCommand, commands.HEADER.byteLength);

    // Populate the packet header bytes
    command[1] = command.length;
    command[2] = this.#decRollingCounter();
    command[3] = this.#calculateChecksum(command);

    return this.#queueWriteCommand(command);
  }

  // commands
  async #writeToDevice(buffer: Uint8Array) {
    let chunk;
    let offset = 0;
    let remaining = buffer.length;
    // We can only write 20 bytes at a time so break up the buffer and send it across.
    while (remaining > 0) {
      try {
        if (remaining > this.device.maxPacketLength) {
          chunk = buffer.subarray(offset, offset + this.device.maxPacketLength);
          remaining -= this.device.maxPacketLength;
          offset += this.device.maxPacketLength;
        } else {
          chunk = buffer.subarray(offset, offset + remaining);
          remaining = 0;
        }
        await this.device.writeCommand(chunk); // eslint-disable-line no-await-in-loop
      } catch (error) {
        log(`Write Failure: ${error}`);
      }
    }
  }

  #queueWriteCommand(command: Uint8Array) {
    log(`command queued: ${bufferToHex(command)}`);
    return new Promise<DataView>((resolve, reject) => {
      this.writeQueue.push({
        command: command[4],
        rollingCounter: command[2],
        buffer: command,
        written: false,
        resolve,
        reject,
      });
      setTimeout(() => {
        this.writeQueue = this.writeQueue.filter(
          (q) => q.command === command[4] && q.rollingCounter !== command[2],
        );
        reject(
          new Error(
            `write command timed out after 5s. Command: ${command[4].toString(
              16,
            )} Rolling Counter: ${command[2].toString(16)}`,
          ),
        );
      }, 5000);
    });
  }

  async #getStatus() {
    const response = await this.sendCommand(commands.GET_STATUS);
    const status = {
      mainFirmwareVersion: `${response.getUint8(2)}.${response.getUint8(3)}`,
      bleFirmwareVersion: `${response.getUint8(6)}.${response.getUint8(9)}`,
      battery: response.getUint8(10),
      chargingStatus: `${response.getUint8(11)}`,
    };

    return status;
  }

  async #getAvailableSensors() {
    await this.sendCommand(commands.GET_SENSOR_IDS).then((response) => {
      this.availableSensors = response.getUint32(0, true);
      log(`Get Available Sensors Returned ${this.availableSensors}`);
    });

    let mask = 1;
    for (let i = 0; i < 31; ++i) {
      if ((this.availableSensors & mask) === mask) {
        await this.#getSensorInfo(i); // eslint-disable-line no-await-in-loop
      }
      mask <<= 1;
    }
  }

  async #getDefaultSensorsMask() {
    const response = await this.sendCommand(commands.GET_DEFAULT_SENSORS_MASK);
    this.defaultSensorsMask = response.getUint32(0, true);
    log(`Default Sensors:`);
    dir(this);
  }

  async #getDeviceInfo() {
    const response = await this.sendCommand(commands.GET_INFO);
    const decoder = new TextDecoder("utf-8");
    // OrderCode offset = 6 (header+cmd+counter)
    // Ordercode length = 16
    this.orderCode = decoder.decode(
      new Uint8Array(response.buffer, 6, 16).filter(nonZero),
    );
    // SerialNumber offset = 22 (OrderCode offset + Ordercode length)
    // SerialNumber length = 16
    this.serialNumber = decoder.decode(
      new Uint8Array(response.buffer, 22, 16).filter(nonZero),
    );
    // DeviceName offset = 38 (SerialNumber offset + SerialNumber length)
    // DeviceName length = 32
    this.name = decoder.decode(
      new Uint8Array(response.buffer, 38, 32).filter(nonZero),
    );
    log(`Device Info:`);
    dir(this);
  }

  async #getSensorInfo(i: number) {
    const command = new Uint8Array(commands.GET_SENSOR_INFO);

    command[1] = i;

    const response = await this.sendCommand(command);
    // We are getting false positives returned so making sure it has a sensorid sorts that out
    // until I can get with Kevin to figure out what is going on.
    const sensorId = response.getUint32(2, true);
    if (sensorId <= 0) return;

    const decoder = new TextDecoder("utf-8");

    const measurementInfo = new MeasurementInfo({
      type: response.getUint8(6), // 0 = Real64 or 1 = Int32
      mode: response.getUint8(7), // 0 = Periodic, 1 = Aperiodic
      minValue: response.getFloat64(108, true),
      maxValue: response.getFloat64(116, true),
      uncertainty: response.getFloat64(100, true),
      minPeriod: response.getUint32(124, true) / 1000,
      maxPeriod:
        ((response.getUint32(132, true) << 32) +
          response.getUint32(128, true)) /
        1000,
      typicalPeriod: response.getUint32(136, true) / 1000,
      granularity: response.getUint32(140, true) / 1000,
    });

    const sensorSpecs = new SensorSpecs({
      number: response.getUint8(0),
      // sensorDescription offset = 14 (6 bytes (header+cmd+counter) + 8 bytes (other fields))
      // sensorDescription length = 60
      name: decoder.decode(
        new Uint8Array(response.buffer, 14, 60).filter(nonZero),
      ),
      // sensorUnit offset = 74 (sensorDescription offset + sensorDescription length)
      // sensorUnit length = 32
      unit: decoder.decode(
        new Uint8Array(response.buffer, 74, 32).filter(nonZero),
      ),
      mutalExclusionMask: response.getUint32(144, true),
      measurementInfo,
      id: sensorId,
    });

    const sensor = new Sensor(sensorSpecs);

    log(`Get Sensor Info Returned`);
    dir(sensor);

    this.sensors.push(sensor);
    sensor.on("state-changed", () => {
      log(`Sensor Restart: ${sensor.number}`);

      // Look through all the sensors to make sure that they aren't mutually exclusive.
      if (sensor.enabled) {
        this.measurementPeriod = sensor.specs.measurementInfo.typicalPeriod;
        this.sensors.forEach((sensor2) => {
          if (sensor.number !== sensor2.number) {
            if (sensor2.enabled) {
              const mask = 1 << sensor2.number;
              if ((mask & sensor.specs.mutalExclusionMask) === mask) {
                sensor2.enabled = false;
              } else if (
                sensor2.specs.measurementInfo.typicalPeriod >
                this.measurementPeriod
              ) {
                this.measurementPeriod =
                  sensor2.specs.measurementInfo.typicalPeriod;
              }
            }
          }
        });
      }
      this.#restartMeasurements();
    });
  }

  async #restartMeasurements() {
    const wasCollecting = this.collecting;
    if (this.collecting) {
      try {
        await this.stopMeasurements();
      } catch (err) {
        console.error(err);
      }
    }
    if (!this.collecting && wasCollecting) {
      try {
        await this.startMeasurements();
      } catch (err) {
        console.error(err);
      }
    }
  }

  setMeasurementPeriod(measurementPeriodInMicroseconds: number) {
    const command = new Uint8Array(commands.SET_MEASUREMENT_PERIOD);
    const minMeasurementPeriodInMicroseconds = this.minMeasurementPeriod * 1000;

    if (measurementPeriodInMicroseconds < minMeasurementPeriodInMicroseconds) {
      measurementPeriodInMicroseconds = minMeasurementPeriodInMicroseconds;
    }

    log(`MeasurementPeriod: ${measurementPeriodInMicroseconds}`);
    command[3] = (measurementPeriodInMicroseconds >> 0) & 0xff;
    command[4] = (measurementPeriodInMicroseconds >> 8) & 0xff;
    command[5] = (measurementPeriodInMicroseconds >> 16) & 0xff;
    command[6] = (measurementPeriodInMicroseconds >> 24) & 0xff;
    return this.sendCommand(command);
  }

  getEnabledChannelMask() {
    let channelMask = 0;
    const enabledSensors = this.sensors.filter((s) => s.enabled);
    enabledSensors.forEach((s) => {
      channelMask += 1 << s.number;
    });
    return channelMask;
  }

  async startMeasurements() {
    await this.setMeasurementPeriod(this.measurementPeriod * 1000);
    const channelMask = this.getEnabledChannelMask();
    log(`ChannelMask: ${channelMask}`);
    const command = new Uint8Array(commands.START_MEASUREMENTS);
    command[3] = (channelMask >> 0) & 0xff;
    command[4] = (channelMask >> 8) & 0xff;
    command[5] = (channelMask >> 16) & 0xff;
    command[6] = (channelMask >> 24) & 0xff;
    const response = await this.sendCommand(command);
    if (response.getUint8(0) === 0) {
      this.collecting = true;
      this.emit("measurements-started");
    }
  }

  async stopMeasurements() {
    const response = await this.sendCommand(commands.STOP_MEASUREMENTS);
    if (response.getUint8(0) === 0) {
      this.collecting = false;
      this.emit("measurements-stopped");
    }
  }
}
