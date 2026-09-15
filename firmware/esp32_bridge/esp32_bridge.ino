#include <SPI.h>
#include <LoRa.h>

#define SS_PIN    15
#define RST_PIN   4
#define DIO0_PIN  16

#define BAND      433E6
#define BW        125E3

int cfgSF = 7;
int cfgCR = 5;
int cfgTX = 7;

void setup() {
  Serial.begin(115200);

  LoRa.setPins(SS_PIN, RST_PIN, DIO0_PIN);

  if (!LoRa.begin(BAND)) {
    Serial.println("OK|lora_init_failed");
    while (true);
  }

  LoRa.setSignalBandwidth(BW);
  LoRa.setSpreadingFactor(cfgSF);
  LoRa.setCodingRate4(cfgCR);
  LoRa.setTxPower(cfgTX, PA_OUTPUT_PA_BOOST_PIN);
  LoRa.enableCrc();

  LoRa.receive();

  Serial.println("OK|ready");
}

void loop() {
  if (Serial.available() > 0) {
    String linea = Serial.readStringUntil('\n');
    linea.trim();
    if (linea.length() > 0) {
      handleSerialLine(linea);
    }
  }

  checkLoRa();
}

void handleSerialLine(String linea) {
  if (linea.startsWith("1|")) {
    sendOverLoRa(linea.substring(2));
  } else if (linea.startsWith("2|")) {
    applyConfig(linea.substring(2));
  }
}

void sendOverLoRa(String hex) {
  uint8_t bytes[255];
  int n = hexToBytes(hex, bytes, sizeof(bytes));
  if (n <= 0) return;

  LoRa.beginPacket();
  LoRa.write(bytes, n);
  LoRa.endPacket();

  LoRa.receive();

  Serial.println("OK|sent");
}

void applyConfig(String csv) {
  int c1 = csv.indexOf(',');
  int c2 = csv.indexOf(',', c1 + 1);
  if (c1 < 0 || c2 < 0) return;

  cfgSF = csv.substring(0, c1).toInt();
  cfgCR = csv.substring(c1 + 1, c2).toInt();
  cfgTX = csv.substring(c2 + 1).toInt();

  LoRa.setSpreadingFactor(cfgSF);
  LoRa.setCodingRate4(cfgCR);
  LoRa.setTxPower(cfgTX, PA_OUTPUT_PA_BOOST_PIN);

  LoRa.receive();

  Serial.println("OK|config");
}

void checkLoRa() {
  int size = LoRa.parsePacket();
  if (size <= 0) return;

  int   rssi = LoRa.packetRssi();
  float snr  = LoRa.packetSnr();
  long  fei  = LoRa.packetFrequencyError();

  String out = "R|";
  while (LoRa.available()) {
    uint8_t b = (uint8_t)LoRa.read();
    out += byteToHex(b);
  }

  out += "|";
  out += String(rssi);
  out += ",";
  out += String(snr, 2);
  out += ",";
  out += String(fei);

  Serial.println(out);
}

int hexToBytes(String hex, uint8_t *out, int maxOut) {
  int len = hex.length();
  if (len % 2 != 0) return -1;

  int n = len / 2;
  if (n > maxOut) return -1;

  for (int i = 0; i < n; i++) {
    int hi = hexCharToVal(hex.charAt(i * 2));
    int lo = hexCharToVal(hex.charAt(i * 2 + 1));
    if (hi < 0 || lo < 0) return -1;
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return n;
}

int hexCharToVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

String byteToHex(uint8_t b) {
  const char *d = "0123456789ABCDEF";
  String s = "";
  s += d[(b >> 4) & 0x0F];
  s += d[b & 0x0F];
  return s;
}
