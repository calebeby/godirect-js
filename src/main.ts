import "./style.css";
import goDirect from "./godirect/godirect";
import { bufferToHex } from "./godirect/utils";

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
    startMeasurements: false,
  });

  console.log(
    "RR",
    bufferToHex(
      (
        await d.sendCommand(
          // new Uint8Array([0x27, 0x66, 0x00, 0x00, 0x00, 0x00, 0x10]),
          // new Uint8Array([0x27, 0x66, 0x04, 0x00, 0x00, 0x00, 0x04]),
          // new Uint8Array([0x27, 0x66, 0x10, 0x00, 0x00, 0x00, 0xf7]),
          // new Uint8Array([0x5e]),
          // new Uint8Array([ 0x60, 0x00, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x00, 0x00, ]),
          new Uint8Array([0x1c, 0x01]),
        )
      ).buffer.slice(6),
    ),
  );
});
