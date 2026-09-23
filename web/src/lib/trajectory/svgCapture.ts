// v6.0 Section 6.5 - rasterizes a chart's <svg> element to a PNG data URL
// for embedding in the exported PDF report. Manual serialize->Image->canvas
// round-trip rather than html2canvas for the charts specifically: they are
// plain SVG with no external resources, so this is more direct and avoids
// html2canvas's own SVG-support quirks. html2canvas remains available for
// anything DOM-based the export pipeline needs later.
export function svgElementToPngDataUrl(svg: SVGSVGElement, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number) ?? [0, 0, svg.clientWidth, svg.clientHeight];
    const [, , vbWidth, vbHeight] = viewBox;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(vbWidth));
    clone.setAttribute("height", String(vbHeight));
    // Ensure a black background (charts are drawn assuming the app's dark
    // backdrop; without this the PNG would have a transparent/white background).
    clone.insertAdjacentHTML("afterbegin", `<rect x="0" y="0" width="${vbWidth}" height="${vbHeight}" fill="#000000" />`);

    const serialized = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = vbWidth * scale;
      canvas.height = vbHeight * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/**
 * Re-encodes a data URL image at a capped max dimension, to keep exported
 * PDF size reasonable for longer flights (the 3D viewport snapshot and
 * chart images are otherwise captured at device pixel ratios well beyond
 * what a ~540pt-wide PDF page can usefully show).
 */
export function downscaleDataUrl(dataUrl: string, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= maxWidth) {
        resolve(dataUrl);
        return;
      }
      const scale = maxWidth / img.width;
      const canvas = document.createElement("canvas");
      canvas.width = maxWidth;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
