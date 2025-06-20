export default class WebUsbDeviceAdapter {
  webUsbNativeDevice: HIDDevice;
  onResponse: null | ((data: DataView) => void);
  onClosed: null | (() => void);
  reportId: number;
  maxPacketLength: number;

  constructor(webUsbNativeDevice: HIDDevice) {
    this.webUsbNativeDevice = webUsbNativeDevice;
    this.onResponse = null;
    this.onClosed = null;
    this.reportId = 0;
    this.maxPacketLength = 63; // standard hid packets are 64 so reserve one for the length
  }

  async writeCommand(commandBuffer: Uint8Array) {
    // Add the length of the command buffer as first byte
    const tmp = new Uint8Array([
      commandBuffer.byteLength,
      ...commandBuffer,
      // This was my change - pads the end of the buffer with 0's'
      // To make the report the correct (fixed) length.
      // Apparently the actual godirect devices allow shorter reports,
      // but according to the spec reports should be fixed lengths,
      // and circuitpython can't be configured to allow shorter-than-maximum length reports
      ...Array(this.maxPacketLength - commandBuffer.length).fill(0),
    ]);
    await this.webUsbNativeDevice.sendReport(this.reportId, tmp);
  }

  // Todo: bikeshed on name of this function
  async setup({
    onClosed,
    onResponse,
  }: {
    onClosed: () => void;
    onResponse: (dataview: DataView) => void;
  }) {
    await this.webUsbNativeDevice.open();
    this.onResponse = onResponse;
    this.onClosed = onClosed;
    this.reportId = this.webUsbNativeDevice.collections[0].outputReports?.[0]
      .reportId as number;
    this.webUsbNativeDevice.oninputreport = (e) => {
      // Pull off the length byte before sending it along for processing
      const data = new DataView(e.data.buffer.slice(1));
      this.onResponse?.(data);
    };
  }

  async close() {
    this.webUsbNativeDevice.close();
    this.onClosed?.();
  }
}
