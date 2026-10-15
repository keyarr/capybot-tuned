import { AnyMessageContent, MiscMessageGenerationOptions, WASocket } from '@whiskeysockets/baileys';

/**
 * Envia mensagem sem nunca lançar exceção.
 * Se o socket estiver fechado / em reconexão (428, 408, 503, 515, EAI_AGAIN...),
 * apenas loga e retorna undefined em vez de derrubar o processo.
 */
export const safeSendMessage = async (
  sock: WASocket,
  jid: string,
  content: AnyMessageContent,
  options?: MiscMessageGenerationOptions
): Promise<unknown> => {
  try {
    return await sock.sendMessage(jid, content, options);
  } catch (error) {
    const err = error as { output?: { statusCode?: number }; message?: string };
    console.warn(
      `⚠️ safeSend: envio para ${jid} ignorado (socket instável). status=${err?.output?.statusCode ?? 'n/a'} msg=${err?.message ?? error}`
    );
    return undefined;
  }
};
