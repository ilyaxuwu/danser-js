// Replay parser to parse actual osu! osr binaries via LZMA.
// Uses lzma for browser or node decompression.

export class ReplayParser {
  /**
   * Parse an OSR ArrayBuffer
   * @param {ArrayBuffer} buffer 
   */
  static async parse(buffer) {
    const data = new DataView(buffer);
    let offset = 0;

    const readByte = () => {
      const val = data.getUint8(offset);
      offset += 1;
      return val;
    };

    const readShort = () => {
      const val = data.getInt16(offset, true);
      offset += 2;
      return val;
    };

    const readInt = () => {
      const val = data.getInt32(offset, true);
      offset += 4;
      return val;
    };

    const readLong = () => {
      const val = data.getBigInt64(offset, true);
      offset += 8;
      return val;
    };

    const readString = () => {
      const isPresent = readByte();
      if (isPresent !== 0x0b) return '';
      
      let length = 0;
      let shift = 0;
      while (true) {
        const byte = readByte();
        length |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
        if (shift >= 32) break; // Defensive
      }
      
      const strBytes = new Uint8Array(buffer, offset, length);
      const str = new TextDecoder('utf-8').decode(strBytes);
      offset += length;
      return str;
    };

    const mode = readByte();
    const version = readInt();
    const beatmapMD5 = readString();
    const playerName = readString();
    const replayMD5 = readString();
    
    const count300 = readShort();
    const count100 = readShort();
    const count50 = readShort();
    const countGeki = readShort();
    const countKatu = readShort();
    const countMiss = readShort();
    
    const totalScore = readInt();
    const maxCombo = readShort();
    const perfectCombo = readByte();
    const mods = readInt();
    
    const lifeBar = readString();
    const timestamp = readLong();
    const compressedLength = readInt();
    
    const compressedData = new Uint8Array(buffer, offset, compressedLength);
    offset += compressedLength;
    
    const onlineId = readLong();

    const replayDataStr = await this.decompress(compressedData);
    const frames = this.parseReplayFrames(replayDataStr);

    return {
      mode, version, beatmapMD5, playerName, replayMD5,
      count300, count100, count50, countGeki, countKatu, countMiss,
      totalScore, maxCombo, perfectCombo, mods, lifeBar, timestamp,
      onlineId, frames
    };
  }

  static async decompress(uint8Array) {
    if (typeof window !== 'undefined' && window.LZMA) {
      // Direct browser fallback if script tag is used
      return new Promise((resolve, reject) => {
        window.LZMA.decompress(uint8Array, (result, error) => {
          if (error) reject(error);
          else resolve(result);
        });
      });
    }

    // Try dynamic import (Vite can handle node modules natively via esbuild if configured, but lzma is tricky)
    try {
      const lzmaMod = await import('lzma');
      const lzma = lzmaMod.default || lzmaMod;
      return new Promise((resolve, reject) => {
        lzma.decompress(uint8Array, (result, error) => {
          if (error) reject(error);
          else resolve(result);
        });
      });
    } catch (e) {
      throw new Error("LZMA decompression failed. Ensure 'lzma' is available.");
    }
  }

  static parseReplayFrames(replayString) {
    const frames = [];
    let currentTime = 0;
    
    const parts = replayString.split(',');
    for (const part of parts) {
      if (!part.trim()) continue;
      const [w, x, y, z] = part.split('|');
      if (!w || !x || !y) continue;
      
      const delta = parseInt(w, 10);
      const parsedX = parseFloat(x);
      const parsedY = parseFloat(y);
      const keys = parseInt(z, 10);
      
      if (delta === -12345) continue;
      
      currentTime += delta;
      frames.push({
        time: currentTime,
        x: parsedX,
        y: parsedY,
        keys: keys
      });
    }
    
    return frames;
  }
}
