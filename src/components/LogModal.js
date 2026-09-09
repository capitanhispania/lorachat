/*
 * ==========================================================================
 * ARCHIVO: src/components/LogModal.js
 * QUÉ ES: La ventana emergente (pop-up) que muestra los logs de la app.
 *         Se abre desde el icono de "librito de log" de la lista de chats.
 * --------------------------------------------------------------------------
 * DEPENDE DE: Logger (lee los logs y se suscribe para refrescarse en vivo).
 * RECIBE POR PROPS:
 *   visible  -> true/false, si el pop-up está abierto.
 *   onClose  -> función para cerrarlo.
 *
 * FLUJO:
 *   al abrirse -> lee los logs actuales y se suscribe a cambios.
 *   mientras está abierto -> cada nueva línea aparece al instante.
 *   al cerrarse -> se desuscribe.
 *   botón "Borrar" -> Logger.clear() vacía el registro.
 * ==========================================================================
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Logger from '../services/Logger';

export default function LogModal({ visible, onClose }) {
  // Copia local de los logs para pintarlos.
  const [logs, setLogs] = useState([]);

  // Cuando el pop-up se abre, cargamos y nos suscribimos a cambios.
  useEffect(() => {
    if (!visible) return; // si está cerrado, no hacemos nada

    // Copia inicial de los logs actuales.
    setLogs([...Logger.getLogs()]);

    // Suscripción: cada cambio en el Logger refresca la lista.
    const unsub = Logger.subscribe(() => setLogs([...Logger.getLogs()]));

    // Al cerrar el pop-up, cancelamos la suscripción.
    return () => unsub();
  }, [visible]);

  // hora(): formatea el timestamp como HH:MM:SS para cada línea.
  function hora(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      {/* Fondo semitransparente */}
      <View style={styles.overlay}>
        {/* Caja del pop-up */}
        <View style={styles.box}>
          {/* Cabecera con título y botones */}
          <View style={styles.header}>
            <Text style={styles.title}>Logs</Text>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity onPress={() => Logger.clear()} style={styles.btn}>
                <Text style={styles.btnText}>Borrar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.btn}>
                <Text style={styles.btnText}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Lista de logs desplazable */}
          <ScrollView style={styles.scroll}>
            {logs.length === 0 ? (
              <Text style={styles.empty}>No hay logs todavía.</Text>
            ) : (
              logs.map((l, i) => {
                // Los errores se pintan en rojo para localizarlos rápido.
                const esError = l.text.startsWith('error:');
                return (
                  <Text
                    key={i}
                    style={[styles.line, esError && styles.lineError]}
                  >
                    {hora(l.ts)}  {l.text}
                  </Text>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  box: {
    backgroundColor: '#fff',
    borderRadius: 10,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: '#075E54',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  btn: { marginLeft: 12 },
  btnText: { color: '#fff', fontSize: 14 },
  scroll: { padding: 10 },
  empty: { color: '#888', textAlign: 'center', marginTop: 20 },
  // Fuente monoespaciada para que los logs se lean alineados.
  line: { fontSize: 12, color: '#222', fontFamily: 'monospace', marginBottom: 3 },
  lineError: { color: '#c0392b' },
});
