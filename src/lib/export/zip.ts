type ZipFile = {
  name: string;
  data: Uint8Array;
  mediaType?: string;
};

const encoder = new TextEncoder();

export function createZipBlob(files: Array<{ name: string; content: string | Blob; mediaType?: string }>): Promise<Blob> {
  return Promise.all(
    files.map(async (file): Promise<ZipFile> => ({
      name: file.name,
      mediaType: file.mediaType,
      data:
        typeof file.content === "string"
          ? encoder.encode(file.content)
          : new Uint8Array(await file.content.arrayBuffer()),
    })),
  ).then((resolvedFiles) => {
    const bytes = createZipBytes(resolvedFiles);
    const payload = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(payload).set(bytes);
    return new Blob([payload], { type: "application/zip" });
  });
}

function createZipBytes(files: ZipFile[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const localHeader = concatBytes(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    );
    localParts.push(localHeader, file.data);
    centralParts.push(
      concatBytes(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ),
    );
    offset += localHeader.length + file.data.length;
  }

  const centralDirectory = concatBytes(...centralParts);
  const localData = concatBytes(...localParts);
  const end = concatBytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDirectory.length),
    u32(localData.length),
    u16(0),
  );
  return concatBytes(localData, centralDirectory, end);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u16(value: number): Uint8Array {
  const output = new Uint8Array(2);
  const view = new DataView(output.buffer);
  view.setUint16(0, value, true);
  return output;
}

function u32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  const view = new DataView(output.buffer);
  view.setUint32(0, value >>> 0, true);
  return output;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
