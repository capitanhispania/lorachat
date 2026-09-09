/*
 * ==========================================================================
 * ARCHIVO: src/services/FrameCodec.js
 * QUÉ ES: Traductor entre "objeto trama" y "bytes", y helpers de hex/utf8.
 * --------------------------------------------------------------------------
 * LA TRAMA BINARIA (lo que viaja por LoRa) tiene este formato:
 *
 *   [ USER_ID (4 bytes) ][ MESSAGE_ID (4 bytes) ][ TIPO (1 byte) ][ TEXTO... ]
 *
 *   - USER_ID    : el ID de QUIEN ENVÍA la trama (el mío al enviar).
 *   - MESSAGE_ID : identificador del mensaje (contador que empieza en 0).
 *   - TIPO       : 0 = mensaje normal, 1 = ACK.
 *   - TEXTO      : bytes UTF-8 del texto (vacío en los ACK).
 *
 * Los enteros de 4 bytes se guardan en "big-endian" (el byte más
 * significativo primero). Da igual el criterio mientras las dos placas
 * usen el mismo, y como la app es la misma en ambos móviles, coincide.
 * --------------------------------------------------------------------------
 * NO DEPENDE de ningún otro archivo del proyecto.
 * Lo usan: ChatManager (para construir/leer tramas) y SerialService (hex).
 *
 * FUNCIONES EXPORTADAS:
 *   TYPE_MSG, TYPE_ACK  -> constantes de tipo.
 *   encodeFrame(obj)    -> objeto trama  -> Uint8Array (bytes).
 *   decodeFrame(bytes)  -> Uint8Array    -> objeto trama.
 *   bytesToHex(bytes)   -> Uint8Array    -> string hex.
 *   hexToBytes(hex)     -> string hex     -> Uint8Array.
 * ==========================================================================
 */

// Tipos de trama. Deben coincidir con los que interpreta la app al recibir.
export const TYPE_MSG = 0; // mensaje normal de chat
export const TYPE_ACK = 1; // acuse de recibo
export const TYPE_HELLO = 2; // señal "¿Hay alguien ahí?" (presentación por broadcast)

// --- Helpers de texto <-> bytes en UTF-8 -------------------------------
// RN no trae TextEncoder de forma fiable, así que usamos un truco clásico
// y sin dependencias: encodeURIComponent + unescape produce una cadena
// donde cada carácter equivale a UN byte UTF-8.

// textToBytes(): convierte un string en sus bytes UTF-8.
function textToBytes(str) {
  // encodeURIComponent escapa a %XX; unescape lo convierte en "binary string".
  const bin = unescape(encodeURIComponent(str));
  // Cada carácter de esa cadena es un byte (0..255).
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// bytesToText(): convierte bytes UTF-8 de vuelta a string.
function bytesToText(bytes) {
  // Reconstruimos la "binary string" carácter a carácter...
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // ...y deshacemos el truco para recuperar el texto original.
  return decodeURIComponent(escape(bin));
}

// --- Helpers de escritura/lectura de enteros de 4 bytes ----------------

// writeUint32(): escribe un entero de 32 bits en 4 posiciones del buffer
// en formato big-endian (byte más alto primero).
function writeUint32(buf, offset, value) {
  // value >>> 0 fuerza a tratarlo como entero sin signo de 32 bits.
  const v = value >>> 0;
  buf[offset] = (v >>> 24) & 0xff;     // byte más significativo
  buf[offset + 1] = (v >>> 16) & 0xff;
  buf[offset + 2] = (v >>> 8) & 0xff;
  buf[offset + 3] = v & 0xff;          // byte menos significativo
}

// readUint32(): lee un entero de 32 bits big-endian desde el buffer.
function readUint32(buf, offset) {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>> 0 // >>> 0 para devolverlo sin signo
  );
}

// --- Codificación / decodificación de la trama completa ----------------

// encodeFrame(): recibe { userId, messageId, type, text } y devuelve los bytes.
export function encodeFrame({ userId, messageId, type, text }) {
  // Si hay texto lo pasamos a bytes; si no, array vacío (caso ACK).
  const textBytes = text ? textToBytes(text) : new Uint8Array(0);
  // Tamaño total = 4 (userId) + 4 (messageId) + 1 (tipo) + longitud del texto.
  const buf = new Uint8Array(9 + textBytes.length);

  writeUint32(buf, 0, userId);     // bytes 0..3  -> USER_ID
  writeUint32(buf, 4, messageId);  // bytes 4..7  -> MESSAGE_ID
  buf[8] = type & 0xff;            // byte 8      -> TIPO
  buf.set(textBytes, 9);           // bytes 9..   -> TEXTO

  return buf;
}

// decodeFrame(): recibe los bytes y reconstruye el objeto trama.
// Devuelve null si la trama no es válida (para eso están estas comprobaciones).
export function decodeFrame(bytes) {
  // Una trama válida ocupa como mínimo 9 bytes (cabecera sin texto).
  if (bytes.length < 9) return null;

  const userId = readUint32(bytes, 0);    // USER_ID
  const messageId = readUint32(bytes, 4); // MESSAGE_ID
  const type = bytes[8];                  // TIPO

  // Si el TIPO no es ninguno de los que conocemos, la trama está corrupta
  // (o no es nuestra). Sin esta comprobación se descartaría en silencio más
  // adelante sin dejar rastro en el log.
  if (type !== TYPE_MSG && type !== TYPE_ACK && type !== TYPE_HELLO) return null;

  // El resto (a partir del byte 9) es el texto, si lo hay.
  const textBytes = bytes.slice(9);
  const text = textBytes.length ? bytesToText(textBytes) : '';

  return { userId, messageId, type, text };
}

// --- Helpers hex <-> bytes (para el tramo USB) -------------------------

// bytesToHex(): Uint8Array -> string hex en mayúsculas ("A1B2..").
export function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    // toString(16) da el hex; padStart asegura siempre 2 dígitos.
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.toUpperCase();
}

// hexToBytes(): string hex -> Uint8Array.
export function hexToBytes(hex) {
  // Cada byte son 2 caracteres, así que recorremos de 2 en 2.
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
