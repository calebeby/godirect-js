import "./style.css";

import goDirect from "./godirect/godirect.ts";
import { bufferToHex } from "./godirect/utils.ts";

if (!navigator.hid) {
  document.body.innerHTML = `<h1>No webusb support; try Chrome/Edge</h1>`;
}

document.querySelector("button")?.addEventListener("click", async () => {
  if (!navigator.hid) return;
  const devices = await navigator.hid.requestDevice({
    filters: [{ vendorId: 0x08f7, productId: 0x0010 }],
  });
  const device = devices[0];

  if (!device) return;

  const div = document.createElement("div");
  div.textContent = `Connected to ${device.productName}`;
  document.body.append(div);

  const d = await goDirect.createDevice(device, {
    open: true,
    startMeasurements: true,
  });

  const enabledSensors = d.sensors.filter((s) => s.enabled);
  enabledSensors.forEach((sensor) => {
    sensor.on("value-changed", (sensor) => {
      console.log(`${sensor.value} ${sensor.unit}`);
    });
  });

  console.log(
    "RR",
    bufferToHex((await d.sendCommand(new Uint8Array([0x67]))).buffer),
  );
});
