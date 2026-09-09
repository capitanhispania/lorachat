/*
 * ==========================================================================
 * ARCHIVO: src/services/Logger.js
 * QUÉ ES: Registro (log) en memoria de todo lo que va pasando en la app.
 *         Es un "singleton" (un único objeto compartido por toda la app).
 * --------------------------------------------------------------------------
 * IDEA:
 *   - Cualquier parte de la app llama a Logger.log('...') o Logger.error(...).
 *   - Si los logs están ACTIVADOS, la línea se guarda en un array en memoria.
 *   - La ventana de logs (LogModal) se suscribe y se refresca en vivo.
 *   - Si se DESACTIVAN, se borra todo inmediatamente (requisito de la app).
 * --------------------------------------------------------------------------
 * NO DEPENDE de ningún otro archivo (para que cualquiera pueda usarlo sin
 * crear dependencias circulares).
 * LO USAN: SerialService, ChatManager, y las pantallas.
 *
 * MÉTODOS:
 *   init(enabled)   -> fija el estado inicial SIN borrar (al arrancar la app).
 *   setEnabled(b)   -> activa/desactiva; si se desactiva, BORRA todo.
 *   isEnabled()     -> ¿están activados?
 *   log(text)       -> añade una línea normal.
 *   error(ctx, err) -> añade una línea de error con su contexto/ubicación.
 *   clear()         -> vacía los logs.
 *   getLogs()       -> devuelve el array de logs.
 *   subscribe(cb)   -> avisar a la UI cuando cambian los logs.
 * ==========================================================================
 */

// Límite de líneas guardadas, para que la memoria no crezca sin fin.
const MAX_LOGS = 500;

const Logger = {
  enabled: true,   // por defecto ACTIVADOS
  logs: [],        // array de { ts, text }
  listeners: [],   // funciones de la UI a avisar cuando cambian los logs

  // init(): fija el estado inicial al arrancar la app (sin borrar nada).
  init(enabled) {
    this.enabled = enabled;
  },

  // setEnabled(): activa o desactiva los logs.
  // Si se desactivan, se borran TODOS inmediatamente.
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.logs = []; // borrado inmediato al apagar
    }
    this._notify(); // refrescamos la ventana de logs si está abierta
  },

  // isEnabled(): ¿están activados los logs?
  isEnabled() {
    return this.enabled;
  },

  // log(): añade una línea normal al registro.
  log(text) {
    // Si están apagados, no guardamos nada.
    if (!this.enabled) return;
    // Guardamos la línea con su marca de tiempo.
    this.logs.push({ ts: Date.now(), text });
    // Si nos pasamos del máximo, quitamos la más antigua.
    if (this.logs.length > MAX_LOGS) this.logs.shift();
    this._notify();
  },

  // error(): añade una línea de error, con el contexto (dónde ocurrió) y,
  // si está disponible, la primera línea del stack (la "línea de código").
  error(context, err) {
    if (!this.enabled) return;
    // Mensaje del error (o el propio valor si no es un Error).
    const msg = err && err.message ? err.message : String(err);
    // Intentamos sacar la primera línea del stack para ubicar el fallo.
    let donde = '';
    if (err && err.stack) {
      const linea = err.stack.split('\n')[1]; // la 1ª suele ser el mensaje
      if (linea) donde = ' | ' + linea.trim();
    }
    // Formato: "error: [contexto] mensaje | ubicación"
    this.log('error: [' + context + '] ' + msg + donde);
  },

  // clear(): vacía el registro (por ejemplo, botón "Borrar" de la ventana).
  clear() {
    this.logs = [];
    this._notify();
  },

  // getLogs(): devuelve el array de logs actual.
  getLogs() {
    return this.logs;
  },

  // subscribe(): registra un listener de cambios. Devuelve función para quitarlo.
  subscribe(cb) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== cb);
    };
  },

  // _notify(): PRIVADO. Avisa a los suscriptores de que hubo un cambio.
  _notify() {
    this.listeners.forEach((cb) => cb());
  },
};

export default Logger;
