import 'dotenv/config';
import {
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import P from 'pino';
import qrcode from 'qrcode-terminal';
import { handleMessage } from './handlers/message';
import { MAINTENANCE_MODE } from './constants/config';

// Última linha de defesa: loga em vez de derrubar o processo.
// O systemd continua como backup se algo realmente fatal ocorrer.
process.on('unhandledRejection', reason => {
  console.error('⚠️ unhandledRejection (ignorado, processo mantido):', reason);
});

process.on('uncaughtException', err => {
  console.error('⚠️ uncaughtException (ignorado, processo mantido):', err);
});

async function startBot() {
  console.log(
    `   Maintenance Mode: ${MAINTENANCE_MODE ? '🟡 ENABLED' : '🟢 DISABLED'}`
  );

  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'info' }),
    version,
  });

  sock.ev.on('creds.update', saveCreds);

  // Handle QR code generation
  sock.ev.on('connection.update', update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('--------------------------------');
      console.log(JSON.stringify(qr, null, 2));
      console.log('--------------------------------');
      console.log('QR Code received, scan with WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('✅ CapyBot connected successfully!');
      console.log('🎉 Send a message to test!');
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log('❌ Connection closed:', lastDisconnect);
      if (shouldReconnect) {
        // Delay curto evita loop apertado em rede instável (EAI_AGAIN/503/515)
        setTimeout(() => void startBot(), 2000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (msg && !msg.key.fromMe) {
      try {
        await handleMessage(sock, msg);
      } catch (error) {
        // Nunca deixa exceção de handler matar o loop do Baileys
        console.error('⚠️ messages.upsert handler falhou (ignorado):', error);
      }
    }
  });
}

startBot();
