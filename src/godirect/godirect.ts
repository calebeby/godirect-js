import Device from "./Device.js";
import WebBluetoothDeviceAdapter from "./WebBluetoothDeviceAdapter.js";
import WebUsbDeviceAdapter from "./WebUsbDeviceAdapter.js";

const godirect = {
  async createDevice(
    nativeDevice: HIDDevice | BluetoothDevice,
    { open = true, startMeasurements = true } = {},
  ) {
    let adapter;

    if (nativeDevice instanceof HIDDevice) {
      adapter = new WebUsbDeviceAdapter(nativeDevice);
    } else if ("gatt" in nativeDevice) {
      adapter = new WebBluetoothDeviceAdapter(nativeDevice);
    } else {
      throw new Error(`Device Open Failed [ No matching adapter ]`);
    }

    const device = new Device(adapter);

    if (open) {
      try {
        await device.open(startMeasurements);
      } catch (err) {
        console.error(err);
        throw new Error(`Device Open Failed [${err}]`);
      }
    }

    return device;
  },

  /**
   * This invokes the requestDevice method for either navigator.bluetooth or navigator.hid, and returns the selected device as a Device instance.
   * This can only be invoked via a user interaction (e.g. within a click event) otherwise you'll get a security warning.
   * @name selectDevice
   * @param bluetooth - bluetooth or usb
   * @returns Promise object represents a Device instance
   */
  async selectDevice(bluetooth = true) {
    let device;

    if (bluetooth) {
      if (!navigator.bluetooth) {
        return Promise.reject(new Error("No Web Bluetooth support."));
      }

      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "GDX" }],
        optionalServices: ["d91714ef-28b9-4f91-ba16-f0d9a604f112"],
      });
    } else {
      if (!navigator.hid) {
        return Promise.reject(new Error("No Web HID support."));
      }
      const devices = await navigator.hid.requestDevice({
        filters: [
          {
            vendorId: 0x08f7,
            productId: 0x0010,
          },
        ],
      });
      // UI only alllows one at a time anyways so just grab the first one.
      // eslint-disable-next-line prefer-destructuring
      device = devices[0];
    }

    if (!device) throw new DOMException(`No device selected.`);

    return godirect.createDevice(device);
  },
};

export default godirect;
