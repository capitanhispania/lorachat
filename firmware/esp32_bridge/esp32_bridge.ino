/*
  ==========================================================================
  ARCHIVO: esp32_bridge.ino
  QUÉ ES: Firmware "puente tonto" entre el móvil (USB) y la radio LoRa.
          El mismo código va en las DOS placas, sin cambios.
  --------------------------------------------------------------------------
  RESPONSABILIDAD (y NADA más que esto):
    - Lo que llega por USB desde el móvil, lo transmite por LoRa.
    - Lo que llega por LoRa, lo reenvía por USB al móvil.
    - No guarda nada, no entiende de usuarios, mensajes ni ACKs.
      Toda esa inteligencia vive en la app del móvil.
  --------------------------------------------------------------------------
  PROTOCOLO POR USB (líneas de texto ASCII terminadas en '\n'):

    Móvil -> ESP32:
      "1|<hex>"        -> transmite por LoRa los bytes que representa <hex>
      "2|<sf>,<cr>,<tx>" -> aplica configuración de radio (SF, CodingRate, TxPower)

    ESP32 -> Móvil:
      "R|<hex>|<rssi>,<snr>,<fei>"
                       -> llegó un paquete por LoRa; <hex> son sus bytes y
                          detrás van las medidas de calidad de ESE paquete.
      "OK|<algo>"      -> confirmaciones varias (la app las ignora)

  MEDIDAS DE CALIDAD (solo al RECIBIR):
    <rssi> -> potencia con la que llegó la señal, en dBm (número negativo;
              cuanto más cerca de 0, mejor).
    <snr>  -> relación señal/ruido en dB, con 2 decimales (positivo = la
              señal se oye por encima del ruido; LoRa aguanta hasta -20).
    <fei>  -> error de frecuencia en Hz: cuánto se desvía el emisor respecto
              a nuestro cristal. Si es muy grande, las placas están
              descalibradas entre sí.
    Estas tres SOLO existen al recibir: la radio no puede medir su propia
    transmisión, así que al enviar no hay nada equivalente que mandar.
  --------------------------------------------------------------------------
  NOTA SOBRE EL HEX:
    La trama binaria real (USER_ID, MESSAGE_ID, TIPO, TEXTO) se manda por
    LoRa en crudo (bytes) para ocupar poco. Pero por el cable USB usamos
    texto por líneas, y el binario podría contener un '\n' y romper la
    lectura por líneas. Por eso, SOLO en el tramo USB, la trama viaja
    codificada en hexadecimal (cada byte -> 2 caracteres '0'..'F').
    El ESP32 la decodifica antes de mandarla por LoRa, y la codifica de
    nuevo cuando la recibe por LoRa.
  --------------------------------------------------------------------------
  FUNCIONES DE ESTE ARCHIVO:
    setup()            -> arranca USB y LoRa, deja la radio escuchando.
    loop()             -> en cada vuelta atiende USB y luego LoRa.
    handleSerialLine() -> procesa una línea recibida del móvil (1| o 2|).
    sendOverLoRa()     -> decodifica hex y transmite por LoRa.
    applyConfig()      -> parsea "sf,cr,tx" y lo aplica a la radio.
    checkLoRa()        -> si llegó algo por LoRa, lo manda al móvil como "R|".
    hexToBytes()       -> convierte texto hex a bytes.
    byteToHex()        -> convierte un byte a 2 caracteres hex.
  ==========================================================================
*/

#include <SPI.h>    // Bus SPI: el ESP32 habla con el chip SX1278 por aquí.
#include <LoRa.h>   // Librería que maneja el protocolo de radio LoRa.

// ---- Pines de conexión con el módulo RA-02 (iguales en ambas placas) ----
#define SS_PIN    15   // NSS / Chip Select
#define RST_PIN   4    // Reset
#define DIO0_PIN  16   // Pin de aviso "llegó paquete / terminé de enviar"

// ---- Parámetros de radio ----
#define BAND      433E6   // Frecuencia 433 MHz. Debe ser igual en ambas placas.
#define BW        125E3   // Ancho de banda FIJO 125 kHz (la app NO lo cambia).

// Valores de configuración actuales. Empiezan con los de por defecto y la
// app los puede cambiar en caliente con un comando "2|...".
int cfgSF = 7;   // Spreading Factor (7..12)
int cfgCR = 5;   // Coding Rate 4/x (5..8)
int cfgTX = 7;   // Tx Power en dBm (2..20 por el camino PA_BOOST)

// setup(): se ejecuta UNA vez al encender.
void setup() {
  // Puerto USB a 115200 baudios. Es el canal de datos con el móvil.
  Serial.begin(115200);

  // Indicamos a la librería qué pines usa el módulo.
  LoRa.setPins(SS_PIN, RST_PIN, DIO0_PIN);

  // Arrancamos la radio. Si falla, avisamos y paramos aquí para siempre.
  if (!LoRa.begin(BAND)) {
    Serial.println("OK|lora_init_failed");
    while (true);
  }

  // Aplicamos la configuración inicial de radio.
  LoRa.setSignalBandwidth(BW);                    // ancho de banda fijo
  LoRa.setSpreadingFactor(cfgSF);                 // factor de dispersión
  LoRa.setCodingRate4(cfgCR);                     // tasa de codificación
  LoRa.setTxPower(cfgTX, PA_OUTPUT_PA_BOOST_PIN); // potencia por PA_BOOST
  LoRa.enableCrc();                               // descarta paquetes corruptos

  // Dejamos la radio en modo escucha continua desde el arranque.
  LoRa.receive();

  // Avisamos al móvil de que ya estamos listos (la app lo ignora, es informativo).
  Serial.println("OK|ready");
}

// loop(): se repite sin parar. Dos tareas: atender USB y atender LoRa.
void loop() {
  // --- Tarea 1: ¿el móvil nos escribió una línea completa? ---
  if (Serial.available() > 0) {
    // Leemos hasta el salto de línea: eso nos da un comando completo.
    String linea = Serial.readStringUntil('\n');
    // Quitamos posibles espacios o '\r' sobrantes en los extremos.
    linea.trim();
    // Si la línea no está vacía, la procesamos.
    if (linea.length() > 0) {
      handleSerialLine(linea);
    }
  }

  // --- Tarea 2: ¿llegó algo por LoRa? ---
  checkLoRa();
}

// handleSerialLine(): decide qué hacer según el prefijo de la línea.
// Depende de: sendOverLoRa(), applyConfig().
void handleSerialLine(String linea) {
  // Prefijo "1|" -> es un mensaje para transmitir por LoRa.
  if (linea.startsWith("1|")) {
    // substring(2) = todo lo que hay después de "1|" (el hex de la trama).
    sendOverLoRa(linea.substring(2));

  // Prefijo "2|" -> es una configuración de radio.
  } else if (linea.startsWith("2|")) {
    applyConfig(linea.substring(2));
  }
  // Cualquier otra cosa se ignora (comando desconocido).
}

// sendOverLoRa(): recibe el texto hex de la trama, lo convierte a bytes
// y lo transmite por LoRa en crudo.
// Depende de: hexToBytes().
void sendOverLoRa(String hex) {
  // Buffer temporal para los bytes decodificados (255 = máx. razonable LoRa).
  uint8_t bytes[255];
  // Convertimos el hex a bytes y obtenemos cuántos bytes salieron.
  int n = hexToBytes(hex, bytes, sizeof(bytes));
  // Si el hex era inválido o vacío, no enviamos nada.
  if (n <= 0) return;

  // Armamos y enviamos el paquete LoRa con esos bytes tal cual.
  LoRa.beginPacket();
  LoRa.write(bytes, n);
  LoRa.endPacket();

  // Volvemos a modo escucha para no perder respuestas / ACKs.
  LoRa.receive();

  // Confirmación informativa (la app la ignora).
  Serial.println("OK|sent");
}

// applyConfig(): parsea "sf,cr,tx" y lo aplica a la radio en caliente.
void applyConfig(String csv) {
  // Buscamos las dos comas que separan los tres números.
  int c1 = csv.indexOf(',');
  int c2 = csv.indexOf(',', c1 + 1);
  // Si no hay dos comas, el formato es inválido: no hacemos nada.
  if (c1 < 0 || c2 < 0) return;

  // Extraemos cada trozo y lo convertimos a entero.
  cfgSF = csv.substring(0, c1).toInt();
  cfgCR = csv.substring(c1 + 1, c2).toInt();
  cfgTX = csv.substring(c2 + 1).toInt();

  // Aplicamos los nuevos valores. El ancho de banda NO se toca.
  LoRa.setSpreadingFactor(cfgSF);
  LoRa.setCodingRate4(cfgCR);
  LoRa.setTxPower(cfgTX, PA_OUTPUT_PA_BOOST_PIN);

  // Tras reconfigurar, volvemos a escuchar.
  LoRa.receive();

  Serial.println("OK|config");
}

// checkLoRa(): si hay un paquete nuevo, lo lee, lo pasa a hex y lo manda
// al móvil con el prefijo "R|", añadiendo al final sus medidas de calidad.
// Depende de: byteToHex().
void checkLoRa() {
  // ¿Hay paquete? parsePacket() devuelve su tamaño en bytes, o 0 si no hay.
  int size = LoRa.parsePacket();
  if (size <= 0) return;

  // Medidas de calidad del paquete recién llegado. Las leemos AQUÍ, nada más
  // detectarlo, porque se refieren SIEMPRE al último paquete recibido y así
  // no hay duda de a cuál pertenecen.
  int   rssi = LoRa.packetRssi();            // potencia recibida, en dBm
  float snr  = LoRa.packetSnr();             // señal/ruido, en dB
  long  fei  = LoRa.packetFrequencyError();  // desvío de frecuencia, en Hz

  // Construimos la cadena "R|" + hex de cada byte recibido.
  String out = "R|";
  while (LoRa.available()) {
    uint8_t b = (uint8_t)LoRa.read(); // leemos un byte
    out += byteToHex(b);              // lo añadimos como 2 caracteres hex
  }

  // Y pegamos detrás las medidas: "R|<hex>|<rssi>,<snr>,<fei>".
  // La app las separa por '|' y luego por ','; si algún día faltasen,
  // la app sigue funcionando igual (solo dirá que no hay datos de radio).
  out += "|";
  out += String(rssi);      // entero, p.ej. "-83"
  out += ",";
  out += String(snr, 2);    // 2 decimales, p.ej. "9.25"
  out += ",";
  out += String(fei);       // entero, p.ej. "1200"

  // Lo mandamos al móvil como una línea completa.
  Serial.println(out);
  // (No hace falta LoRa.receive() aquí: tras parsePacket la radio ya
  //  vuelve sola a modo escucha.)
}

// hexToBytes(): convierte una cadena hex ("A1B2..") en bytes.
// Devuelve cuántos bytes escribió, o -1 si el hex es inválido.
int hexToBytes(String hex, uint8_t *out, int maxOut) {
  int len = hex.length();
  // El hex válido siempre tiene un número PAR de caracteres (2 por byte).
  if (len % 2 != 0) return -1;

  int n = len / 2; // número de bytes resultantes
  if (n > maxOut) return -1; // no cabe en el buffer

  // Recorremos de dos en dos caracteres.
  for (int i = 0; i < n; i++) {
    int hi = hexCharToVal(hex.charAt(i * 2));     // dígito alto
    int lo = hexCharToVal(hex.charAt(i * 2 + 1)); // dígito bajo
    if (hi < 0 || lo < 0) return -1;              // carácter no hex
    out[i] = (uint8_t)((hi << 4) | lo);           // combinamos en un byte
  }
  return n;
}

// hexCharToVal(): convierte un carácter hex ('0'..'F') en su valor 0..15.
// Devuelve -1 si el carácter no es hexadecimal.
int hexCharToVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

// byteToHex(): convierte un byte (0..255) en 2 caracteres hex en mayúsculas.
String byteToHex(uint8_t b) {
  const char *d = "0123456789ABCDEF"; // tabla de dígitos hex
  String s = "";
  s += d[(b >> 4) & 0x0F]; // dígito alto (los 4 bits de arriba)
  s += d[b & 0x0F];        // dígito bajo (los 4 bits de abajo)
  return s;
}
