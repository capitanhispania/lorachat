# LoRa Chat — App React Native

App de mensajería por LoRa. Toda la lógica (chat, ACK, reintentos,
almacenamiento) vive aquí; el ESP32 es solo un puente.

> **Importante:** funciona en **Android** (el acceso USB-serie genérico no
> está disponible en iOS sin hardware certificado MFi).

---

## Qué contiene este proyecto

Este proyecto contiene solo el **código fuente** (`src/`, `App.js`,
`index.js`) y sus configuraciones. **No incluye la carpeta nativa `android/`**
(que son cientos de archivos generados). La forma más robusta y rápida de
tenerlo funcionando es crear un proyecto RN nuevo y copiar estos archivos
encima. Sigue los pasos:

## Requisitos previos

- Node.js 18 o superior.
- Android Studio + un dispositivo Android físico (con depuración USB).
- Entorno de React Native para Android configurado
  (ver: https://reactnative.dev/docs/set-up-your-environment).

## Puesta en marcha (paso a paso)

1. **Crea un proyecto RN vacío** con el mismo nombre (`lorachat`):

   ```bash
   npx react-native@0.74.5 init lorachat
   ```

2. **Copia encima los archivos de este proyecto**, sustituyendo los que
   pida: `App.js`, `index.js`, `app.json`, `babel.config.js`,
   `metro.config.js`, `package.json` y toda la carpeta `src/`.

3. **Instala las dependencias**:

   ```bash
   cd lorachat
   npm install
   npm install @react-native-async-storage/async-storage react-native-usb-serialport-for-android
   ```

4. **Configura el USB en Android** (ver carpeta `android-setup/`):
   - Añade a `android/app/src/main/AndroidManifest.xml` lo indicado en
     `android-setup/AndroidManifest-additions.xml`.
   - Copia `android-setup/device_filter.xml` a
     `android/app/src/main/res/xml/device_filter.xml`
     (crea la carpeta `res/xml` si no existe).

5. **Conecta el móvil por USB** y lanza la app:

   ```bash
   npm run android
   ```

   > Nota: para conectar el ESP32 necesitarás un cable/adaptador **USB OTG**
   > (el móvil hace de host USB). Si estás depurando por el mismo puerto,
   > usa depuración inalámbrica (WiFi ADB) para dejar el USB libre para el
   > ESP32.

## Estructura del código

```
App.js                     Navegación entre pantallas + arranque.
index.js                   Punto de entrada.
src/
  services/
    FrameCodec.js          Trama binaria <-> bytes, y helpers hex/utf8.
    SerialService.js       Conexión USB, envío/recepción por líneas.
    Storage.js             Persistencia (AsyncStorage): perfil, contactos, chats.
  state/
    ChatManager.js         El cerebro: enviar, recibir, ACK, reintentos.
  screens/
    UsernameScreen.js      Alta de nombre de usuario (primera vez).
    ChatsListScreen.js     Lista de chats + conectar USB + ajustes.
    ChatScreen.js          Conversación (burbujas, ticks, enviar).
    SettingsScreen.js      Ajustes de radio (SF, CR, TxPower).
```

## Flujo resumido

1. Primer arranque → pides nombre → se genera tu `USER_ID` (32 bits).
2. Lista de chats → pulsa **Conectar** para abrir el USB con el ESP32.
3. Abre un chat, escribe → se envía la trama; aparece con **un tick** (✓).
4. Cuando el destinatario responde su ACK → pasa a **doble tick** (✓✓).
5. Los mensajes sin ACK se reintentan cada vez que abres ese chat.
6. Si te escribe alguien nuevo → aparece como *(desconocido)*. Dentro del
   chat, el icono **👤+** (arriba a la derecha) abre "Añadir a contactos":
   le pones nombre y ese nombre queda vinculado a su USER_ID para siempre.

## Logs (depuración)

- En **Ajustes** hay un interruptor **"Activa Logs"** (encendido por
  defecto). Al **apagarlo se borran** todos los logs guardados al instante.
- En la lista de chats, el icono **📖** (junto a ⚙) abre un pop-up con los
  logs en vivo. Verás cada línea que entra y sale del ESP32 y cada decisión
  de la app, por ejemplo:
  - `conectado con esp32 correcto.`
  - `configurado esp32 con valores de settings: SF=7, CR=5, TxPower=7`
  - `enviado mensaje a esp32: 1|C0FFEE99...`
  - `recibido mensaje de esp32: R|...` (incluye los `OK|...` que la app ignora)
  - `ACK de Usuario 3239 para msg #4 -> confirmado (doble tick)`
  - `error: [SerialService.connect] ...` (los errores salen en rojo)
- Los logs viven **en memoria** (no se guardan en disco): son para ver qué
  pasa mientras usas la app, sin necesidad de PC ni cables.
