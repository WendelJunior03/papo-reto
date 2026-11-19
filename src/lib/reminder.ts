/**
 * Lembrete diário via calendário (.ics): vira um evento repetido todo dia com alarme,
 * no app de calendário do celular. Não precisa de servidor, conta nem internet.
 */
export interface ReminderOptions {
  /** "HH:MM" no horário local */
  time: string;
  appUrl: string;
  /** Data do primeiro lembrete; padrão: hoje */
  from?: Date;
  now?: Date;
}

const two = (n: number): string => String(n).padStart(2, "0");

const utcStamp = (d: Date): string =>
  `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}T${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`;

/** Escapa texto conforme RFC 5545. */
const icsText = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export function buildReminderICS({ time, appUrl, from = new Date(), now = new Date() }: ReminderOptions): string {
  const [hh = "20", mm = "00"] = time.split(":");
  const day = `${from.getFullYear()}${two(from.getMonth() + 1)}${two(from.getDate())}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Papo Reto//Lembrete diario//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:lembrete-diario@papo-reto",
    `DTSTAMP:${utcStamp(now)}`,
    // Sem fuso (horário "flutuante"): toca na hora local, mesmo viajando.
    `DTSTART:${day}T${two(Number(hh))}${two(Number(mm))}00`,
    "DURATION:PT10M",
    "RRULE:FREQ=DAILY",
    `SUMMARY:${icsText("Papo Reto · 5 frases de hoje")}`,
    `DESCRIPTION:${icsText(`Seu pacote do dia está pronto. Leva 5 minutos: ${appUrl}`)}`,
    `URL:${appUrl}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText("Hora do inglês: 5 frases de hoje")}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Entrega o arquivo: no iPhone abre "Adicionar ao Calendário"; no Android, o app de agenda. */
export function downloadReminder(ics: string): void {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "papo-reto-lembrete.ics";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
