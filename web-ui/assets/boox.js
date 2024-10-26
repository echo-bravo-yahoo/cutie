function updateSize() {
  const heightOutput = document.querySelector("#height");
  const widthOutput = document.querySelector("#width");
  if (heightOutput && widthOutput) {
    heightOutput.textContent = window.innerHeight;
    widthOutput.textContent = window.innerWidth;
  }
}

window.addEventListener("resize", updateSize);
window.addEventListener("load", updateSize);
