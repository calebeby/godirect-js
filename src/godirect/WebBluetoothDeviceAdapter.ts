import { log } from "./utils.js";

const SERVICE = "d91714ef-28b9-4f91-ba16-f0d9a604f112";
const COMMAND_CHARACTERISTIC = "f4bf14a6-c7d5-4b6d-8aa8-df1a7c83adcb";
const RESPONSE_CHARACTERISTIC = "b41e6675-a329-40e0-aa01-44d2f444babe";

export default class WebBluetoothDeviceAdapter {
  webBluetoothNativeDevice: BluetoothDevice;
  maxPacketLength: number;
  deviceCommand: BluetoothRemoteGATTCharacteristic | null;
  deviceResponse: BluetoothRemoteGATTCharacteristic | null;
  constructor(webBluetoothNativeDevice: BluetoothDevice) {
    this.webBluetoothNativeDevice = webBluetoothNativeDevice;
    this.maxPacketLength = 20;
    this.deviceCommand = null;
    this.deviceResponse = null;
  }

  async writeCommand(commandBuffer: Uint8Array) {
    return this.deviceCommand?.writeValue(commandBuffer);
  }

  // Todo: bikeshed on name of this function
  async setup({
    onClosed,
    onResponse,
  }: {
    onClosed: () => void;
    onResponse: (dataview: DataView) => void;
  }) {
    this.webBluetoothNativeDevice.addEventListener(
      "gattserverdisconnected",
      onClosed,
    );

    try {
      const server = await this.webBluetoothNativeDevice.gatt?.connect();
      const service = await server?.getPrimaryService(SERVICE);
      const characteristics = await service?.getCharacteristics();

      characteristics?.forEach((characteristic) => {
        switch (characteristic.uuid) {
          case COMMAND_CHARACTERISTIC:
            this.deviceCommand = characteristic;
            break;
          case RESPONSE_CHARACTERISTIC:
            this.deviceResponse = characteristic;
            // Setup handler on the characteristic and start notifications.
            this.deviceResponse.addEventListener(
              "characteristicvaluechanged",
              (event) => {
                // @ts-expect-error
                const response = event.target.value;
                onResponse(response);
              },
            );
            this.deviceResponse.startNotifications();
            break;
          default:
            log(`No case found for ${characteristic.uuid}`);
        }
      });
    } catch (err) {
      console.error(err);
    }

    if (!(this.deviceCommand && this.deviceResponse)) {
      throw new Error(
        "Expected command and response characteristics not found",
      );
    }
  }

  async close() {
    return this.webBluetoothNativeDevice.gatt?.disconnect();
  }
}
