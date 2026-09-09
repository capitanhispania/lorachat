/*
 * ==========================================================================
 * ARCHIVO: src/screens/SettingsScreen.js
 * QUÉ ES: Ajustes de la radio LoRa (SF, CR, TxPower) + interruptor de logs.
 *         El ancho de banda es de SOLO LECTURA (cambiarlo desincronizaría
 *         las radios y dejarían de oírse).
 * --------------------------------------------------------------------------
 * DEPENDE DE: Storage, ChatManager, Logger.
 * RECIBE POR PROPS: onBack -> volver a la lista.
 *
 * "ACTIVA LOGS":
 *   - Encendido por defecto.
 *   - Al APAGARLO, se borran inmediatamente todos los logs (Logger.setEnabled).
 *   - El estado se guarda en el storage para que se recuerde.
 * ==========================================================================
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  StyleSheet,
} from 'react-native';
import Storage from '../services/Storage';
import ChatManager from '../state/ChatManager';
import Logger from '../services/Logger';

export default function SettingsScreen({ onBack }) {
  const [sf, setSf] = useState('7');
  const [cr, setCr] = useState('5');
  const [tx, setTx] = useState('7');
  const [logsOn, setLogsOn] = useState(true); // estado del switch de logs

  // Al montar: cargamos la config de radio y el estado de los logs.
  useEffect(() => {
    (async () => {
      const cfg = await Storage.getConfig();
      setSf(String(cfg.sf));
      setCr(String(cfg.cr));
      setTx(String(cfg.txPower));

      const on = await Storage.getLogsEnabled();
      setLogsOn(on);
    })();
  }, []);

  // limita(): recorta un número al rango [min,max].
  function limita(valor, min, max) {
    let n = parseInt(valor, 10);
    if (isNaN(n)) n = min;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  // guardar(): valida, persiste y envía la config de radio al ESP32.
  async function guardar() {
    const cfg = {
      sf: limita(sf, 7, 12),
      cr: limita(cr, 5, 8),
      txPower: limita(tx, 2, 20),
    };
    await Storage.setConfig(cfg);
    ChatManager.applyConfig(cfg);
    onBack();
  }

  // cambiaLogs(): activa/desactiva los logs al instante.
  // Al apagar, Logger.setEnabled(false) BORRA todos los logs existentes.
  async function cambiaLogs(valor) {
    setLogsOn(valor);            // actualizamos el switch en pantalla
    Logger.setEnabled(valor);    // aplica (y borra si es false)
    await Storage.setLogsEnabled(valor); // recordamos la preferencia
  }

  return (
    <View style={styles.container}>
      {/* Barra superior */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ajustes LoRa</Text>
      </View>

      <View style={styles.body}>
        {/* Spreading Factor */}
        <Text style={styles.label}>Spreading Factor (7 - 12)</Text>
        <TextInput style={styles.input} value={sf} onChangeText={setSf} keyboardType="numeric" />

        {/* Coding Rate */}
        <Text style={styles.label}>Coding Rate 4/x (5 - 8)</Text>
        <TextInput style={styles.input} value={cr} onChangeText={setCr} keyboardType="numeric" />

        {/* Tx Power */}
        <Text style={styles.label}>Tx Power dBm (2 - 20)</Text>
        <TextInput style={styles.input} value={tx} onChangeText={setTx} keyboardType="numeric" />

        {/* Bandwidth: SOLO LECTURA */}
        <Text style={styles.label}>Signal Bandwidth (fijo)</Text>
        <View style={[styles.input, styles.readonly]}>
          <Text style={styles.readonlyText}>125 kHz (no editable)</Text>
        </View>
        <Text style={styles.hint}>
          El ancho de banda está fijo: si cada móvil usara uno distinto, las
          radios dejarían de oírse.
        </Text>

        {/* Interruptor de logs */}
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Activa Logs</Text>
          <Switch value={logsOn} onValueChange={cambiaLogs} />
        </View>
        <Text style={styles.hint}>
          Si lo apagas, se borran todos los logs guardados.
        </Text>

        {/* Botón guardar (solo aplica a la config de radio) */}
        <TouchableOpacity style={styles.button} onPress={guardar}>
          <Text style={styles.buttonText}>Guardar y aplicar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    backgroundColor: '#075E54',
    paddingTop: 40,
    paddingBottom: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: { color: '#fff', fontSize: 30, marginRight: 8, lineHeight: 30 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  body: { padding: 16 },
  label: { fontSize: 14, color: '#333', marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  readonly: { backgroundColor: '#eee', justifyContent: 'center' },
  readonlyText: { color: '#666', fontSize: 15 },
  hint: { fontSize: 12, color: '#888', marginTop: 6 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
  },
  switchLabel: { fontSize: 16, color: '#333', fontWeight: 'bold' },
  button: {
    backgroundColor: '#128C7E',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
