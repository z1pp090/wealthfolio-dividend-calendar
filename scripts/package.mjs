// Zip manifest.json + dist/addon.js (+ dist/addon.css, assets/, README.md) preserving paths.
// Uses Node's zlib-free approach via a tiny store-only zip writer to avoid platform zip tools.
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { deflateRawSync } from "node:zlib";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync("dist", { recursive: true });
const out = join("dist", `${pkg.name}-${pkg.version}.zip`);

const files = ["manifest.json", "README.md", "dist/addon.js"];
if (existsSync("dist/addon.css")) files.push("dist/addon.css");
if (existsSync("assets")) {
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  files.push(...walk("assets").map((p) => p.split("\\").join("/")));
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const locals = [], centrals = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(posix.normalize(f));
  const data = readFileSync(f);
  const comp = deflateRawSync(data);
  const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
  lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
  ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
  locals.push(lh, name, comp);
  centrals.push(ch, name);
  offset += lh.length + name.length + comp.length;
}
const cdSize = centrals.reduce((s, b) => s + b.length, 0);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
writeFileSync(out, Buffer.concat([...locals, ...centrals, eocd]));
console.log("packaged", out, files);
