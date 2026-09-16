import { message, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

// The workbench's export menu hands the browser an `<a download>` on a blob
// URL, and WKWebView drops those on the floor. Catch the click before it gets
// there and route the bytes through a native save panel instead.
export function installDownloads() {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[download]") as HTMLAnchorElement | null;
      if (!anchor || !anchor.href.startsWith("blob:")) return;
      event.preventDefault();
      // A cancelled panel, a read-only folder: say so rather than leave the
      // page carrying an unhandled rejection and the file silently unsaved.
      saveBlob(anchor.href, anchor.getAttribute("download") || "part").catch((e) =>
        void message(String(e), { title: "nurb", kind: "error" }),
      );
    },
    true,
  );
}

async function saveBlob(href: string, name: string) {
  const ext = name.includes(".") ? name.split(".").pop()! : "bin";
  const blob = await fetch(href).then((r) => r.blob());
  const path = await save({
    defaultPath: name,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!path) return;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}
