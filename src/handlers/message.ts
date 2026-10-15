import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { handleText } from './text';
import { handleImage } from './image';
import { handleVideo } from './video';
import {
  DEFAULT_MESSAGE,
  ERROR_MESSAGE,
  MAINTENANCE_MESSAGE,
} from '../constants/messages';
import {
  isUserNotifiedMaintenance,
  markUserAsNotified,
  checkMaintenanceModeChange,
} from '../services/maintenance';
import {
  MAINTENANCE_MODE,
  ALLOWED_NUMBERS,
  isNumberAllowed,
} from '../constants/config';
import { safeSendMessage } from '../utils/safe-send';

export const handleMessage = async (
  sock: WASocket,
  msg: WAMessage
): Promise<void> => {
  const sender = msg.key.remoteJid as string;

  // Allowlist filter: ignore senders not on the list (when list is set).
  // Prefer senderPn (real phone JID) since WhatsApp may address chats by LID.
  // Empty allowlist = respond to everyone.
  if (ALLOWED_NUMBERS.length > 0) {
    const identity = msg.key.senderPn ?? sender;
    if (!isNumberAllowed(identity.replace(/\D/g, ''))) {
      console.log(
        `⛔ Ignored message from non-allowlisted sender: ${sender} (pn: ${msg.key.senderPn ?? 'unknown'})`
      );
      return;
    }
  }

  try {
    const isMaintenanceMode = MAINTENANCE_MODE;

    checkMaintenanceModeChange(isMaintenanceMode);

    if (isMaintenanceMode) {
      // If user hasn't been notified yet, send maintenance message
      if (!isUserNotifiedMaintenance(sender)) {
        await sock.sendMessage(sender, {
          text: MAINTENANCE_MESSAGE,
        });
        markUserAsNotified(sender);
        console.log(`🔧 Maintenance message sent to: ${sender}`);
      }
      return;
    }

    const messageType = getMessageType(msg);

    switch (messageType) {
      case 'text':
        await handleText(sock, sender, msg);
        break;

      case 'image':
        await handleImage(sock, sender, msg);
        break;

      case 'video':
        await handleVideo(sock, sender, msg);
        break;

      default:
        if (!msg.message?.associatedChildMessage) {
          await sock.sendMessage(sender, {
            text: DEFAULT_MESSAGE,
          });
        }
        break;
    }
  } catch (error) {
    console.error('❌ Error processing message:', error);
    // Best-effort: último nível de defesa, nunca pode lançar
    await safeSendMessage(sock, sender, {
      text: ERROR_MESSAGE,
    });
  }
};

const getMessageType = (msg: WAMessage): string => {
  if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
    return 'text';
  } else if (msg.message?.imageMessage) {
    return 'image';
  } else if (msg.message?.videoMessage) {
    return 'video';
  } else {
    return 'unknown';
  }
};
