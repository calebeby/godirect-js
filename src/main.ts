import "./style.css";
import goDirect from "./godirect/godirect";

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
});
