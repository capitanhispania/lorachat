/*
 * ==========================================================================
 * ARCHIVO: src/screens/ChatScreen.js
 * QUÉ ES: La conversación con un contacto. Burbujas (mías a la derecha,
 *         suyas a la izquierda), ticks según ACK, barra para escribir, y un
 *         icono para "añadir a contactos" (ponerle nombre al usuario).
 * --------------------------------------------------------------------------
 * DEPENDE DE: Storage, ChatManager, Logger.
 * RECIBE POR PROPS (de App.js):
 *   peerId -> userId del contacto de esta conversación.
 *   onBack -> volver a la lista de chats.
 *
 * POR QUÉ EL BOTÓN DE AÑADIR A CONTACTOS:
 *   El nombre NO viaja con el mensaje, solo el USER_ID. Así que eres tú quien
 *   le pone nombre. Al guardarlo, ese nombre queda vinculado a ese USER_ID en
 *   el storage, y desde entonces el chat aparece con el nombre en vez de
 *   "DESCONOCIDO".
 *
 * TICKS: mío ack=0 -> "✓" (enviado); mío ack=1 -> "✓✓" (confirmado).
 * ==========================================================================
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import Storage from '../services/Storage';
import ChatManager from '../state/ChatManager';
import Logger from '../services/Logger';

export default function ChatScreen({ peerId, onBack }) {
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [nombre, setNombre] = useState('');       // nombre mostrado del contacto
  const [known, setKnown] = useState(false);       // ¿es un contacto conocido?
  const [showRename, setShowRename] = useState(false); // ¿modal de nombre abierto?
  const [nuevoNombre, setNuevoNombre] = useState(''); // texto del modal

  // carga(): lee mensajes y datos del contacto.
  async function carga() {
    const chat = await Storage.getChat(peerId);
    chat.sort((a, b) => a.ts - b.ts); // orden best-effort por tiempo
    setMensajes(chat);

    const contacts = await Storage.getContacts();
    const c = contacts[String(peerId)];
    if (c) {
      setNombre(c.name);
      setKnown(c.known);
    }
  }

  useEffect(() => {
    carga();
    ChatManager.resendPending(peerId); // reintenta mis mensajes no confirmados
    const unsub = ChatManager.subscribe(carga);
    return () => unsub();
  }, []);

  // enviar(): manda el texto actual.
  async function enviar() {
    const t = texto.trim();
    if (t.length === 0) return;
    setTexto('');
    await ChatManager.sendMessage(peerId, t);
  }

  // abreRename(): abre el modal, precargando el nombre actual.
  function abreRename() {
    setNuevoNombre(known ? nombre : ''); // si es desconocido, empezamos vacío
    setShowRename(true);
  }

  // guardaNombre(): vincula nombre <-> USER_ID en el storage.
  async function guardaNombre() {
    const n = nuevoNombre.trim();
    if (n.length === 0) return; // no permitimos nombre vacío
    // Guardamos el nombre y lo marcamos como conocido a la vez.
    await Storage.upsertContact(peerId, { name: n, known: true });
    Logger.log('contacto guardado: Usuario ' + peerId + ' -> "' + n + '"');
    setNombre(n);
    setKnown(true);
    setShowRename(false);
  }

  // renderItem(): pinta una burbuja.
  function renderItem({ item }) {
    const mine = item.fromMe;
    const ticks = mine ? (item.ack === 1 ? ' ✓✓' : ' ✓') : '';
    return (
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={styles.bubbleText}>
          {item.text}
          <Text style={styles.ticks}>{ticks}</Text>
        </Text>
      </View>
    );
  }

  // Título: nombre si es conocido; si no, aviso de desconocido.
  const titulo = known ? nombre : nombre + ' (desconocido)';

  return (
    <View style={styles.container}>
      {/* Barra superior: volver, nombre, botón añadir a contactos */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>{titulo}</Text>

        {/* Icono para añadir a contactos / renombrar */}
        <TouchableOpacity onPress={abreRename} style={styles.addBtn}>
          <Text style={styles.addBtnText}>{known ? '✏️' : '👤+'}</Text>
        </TouchableOpacity>
      </View>

      {/* Mensajes */}
      <FlatList
        data={mensajes}
        keyExtractor={(item) => (item.fromMe ? 'me-' : 'you-') + item.messageId}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />

      {/* Barra inferior: escribir + enviar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Escribe un mensaje"
          value={texto}
          onChangeText={setTexto}
          maxLength={180}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={enviar}>
          <Text style={styles.sendText}>➤</Text>
        </TouchableOpacity>
      </View>

      {/* Modal para ponerle nombre al usuario (añadir a contactos) */}
      <Modal
        visible={showRename}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowRename(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Añadir a contactos</Text>
            <Text style={styles.modalHint}>
              Ponle un nombre a este usuario (USER_ID {peerId}).
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Nombre"
              value={nuevoNombre}
              onChangeText={setNuevoNombre}
              maxLength={20}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setShowRename(false)} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardaNombre} style={styles.modalBtn}>
                <Text style={[styles.modalBtnText, { fontWeight: 'bold' }]}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECE5DD' },
  header: {
    backgroundColor: '#075E54',
    paddingTop: 40,
    paddingBottom: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: { color: '#fff', fontSize: 30, marginRight: 8, lineHeight: 30 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', flex: 1 },
  addBtn: { paddingHorizontal: 8 },
  addBtnText: { color: '#fff', fontSize: 18 },
  list: { padding: 12 },
  bubble: {
    maxWidth: '80%',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  bubbleMine: { backgroundColor: '#DCF8C6', alignSelf: 'flex-end' },
  bubbleTheirs: { backgroundColor: '#fff', alignSelf: 'flex-start' },
  bubbleText: { fontSize: 15, color: '#111' },
  ticks: { fontSize: 12, color: '#4A90D9' },
  inputBar: {
    flexDirection: 'row',
    padding: 8,
    backgroundColor: '#ECE5DD',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    marginRight: 8,
  },
  sendBtn: {
    backgroundColor: '#128C7E',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendText: { color: '#fff', fontSize: 18 },
  // --- Modal ---
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: { backgroundColor: '#fff', borderRadius: 10, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#075E54', marginBottom: 6 },
  modalHint: { fontSize: 13, color: '#666', marginBottom: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  modalBtnText: { fontSize: 15, color: '#128C7E' },
});
