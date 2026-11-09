export type Tone = "green" | "gray" | "amber" | "red" | "blue" | "lilac";

export const TASK_STATUS = {
  backlog: { label: "Backlog", tone: "gray" },
  todo: { label: "Por hacer", tone: "gray" },
  in_progress: { label: "En curso", tone: "blue" },
  in_review: { label: "En revisión", tone: "amber" },
  done: { label: "Hecho", tone: "green" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const PRIORITY = {
  urgent: { label: "Urgente", tone: "red" },
  high: { label: "Alta", tone: "amber" },
  medium: { label: "Media", tone: "gray" },
  low: { label: "Baja", tone: "gray" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const DEMO_STAGE = {
  requested: { label: "Solicitada", tone: "gray" },
  scheduled: { label: "Agendada", tone: "blue" },
  done: { label: "Realizada", tone: "lilac" },
  trial: { label: "En trial", tone: "amber" },
  paid: { label: "Pagó", tone: "green" },
  no_show: { label: "No asistió", tone: "red" },
  lost: { label: "Perdida", tone: "red" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const BUG_SEVERITY = {
  critical: { label: "Crítico", tone: "red" },
  high: { label: "Alto", tone: "amber" },
  medium: { label: "Medio", tone: "gray" },
  low: { label: "Bajo", tone: "gray" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const BUG_STATUS = {
  new: { label: "Nuevo", tone: "red" },
  triaged: { label: "Clasificado", tone: "amber" },
  in_progress: { label: "En curso", tone: "blue" },
  fixed: { label: "Corregido", tone: "lilac" },
  verified: { label: "Verificado", tone: "green" },
  wont_fix: { label: "No se corrige", tone: "gray" },
  duplicate: { label: "Duplicado", tone: "gray" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const BUG_SOURCE = { manual: "Manual", ziora_app: "App Ziora", sentry: "Sentry", github: "GitHub" } as const;

export const PR_STATE = {
  open: { label: "Abierto", tone: "green" },
  merged: { label: "Merged", tone: "lilac" },
  closed: { label: "Cerrado", tone: "gray" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const CAMPAIGN_STATUS = {
  draft: { label: "Borrador", tone: "gray" },
  scheduled: { label: "Programada", tone: "blue" },
  sending: { label: "Enviando", tone: "amber" },
  sent: { label: "Enviada", tone: "green" },
  failed: { label: "Falló", tone: "red" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const SEND_STATUS = {
  queued: "En cola", sent: "Enviado", delivered: "Entregado", opened: "Abierto", clicked: "Clic",
  bounced: "Rebotó", complained: "Spam", failed: "Falló", skipped: "Omitido",
} as const;

export const CONTENT_PILLAR = {
  producto: { label: "Ziora (producto)", tone: "green" },
  ia_psicoterapia: { label: "IA en psicoterapia", tone: "blue" },
  estudios: { label: "Estudios", tone: "lilac" },
  roi: { label: "ROI del terapeuta", tone: "amber" },
  psicoterapia_moderna: { label: "Psicoterapia moderna", tone: "blue" },
  memes: { label: "Memes", tone: "red" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const CONTENT_CHANNEL = {
  instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", facebook_group: "Grupos FB", linkedin: "LinkedIn", blog: "Blog", email: "Email",
} as const;

export const CONTENT_STATUS = {
  idea: { label: "Idea", tone: "gray" },
  draft: { label: "Borrador", tone: "gray" },
  legal_review: { label: "En revisión", tone: "amber" },
  approved: { label: "Aprobado", tone: "blue" },
  scheduled: { label: "Programado", tone: "lilac" },
  published: { label: "Publicado", tone: "green" },
  discarded: { label: "Descartado", tone: "red" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const RISK = {
  low: { label: "Riesgo bajo", tone: "green" },
  medium: { label: "Riesgo medio", tone: "amber" },
  high: { label: "Riesgo alto", tone: "red" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const CITY = { cdmx: "CDMX", gdl: "Guadalajara", mty: "Monterrey", nyc: "NYC", other: "Otra", tbd: "Por definir" } as const;

export const CONTACT_TAG: Record<string, string> = {
  psychologist: "Psicólogo/a", lead: "Lead", clinic: "Clínica", ziora_user: "Usuario Ziora",
  sponsor: "Sponsor", speaker: "Speaker", panelist: "Panelista", founder: "Founder", angel: "Angel", vc: "VC",
  venue: "Venue", community_partner: "Comunidad", influencer: "Influencer", hospital: "Hospital",
  university: "Universidad", volunteer: "Voluntario", attendee: "Asistente", vendor: "Proveedor",
};

export const CONTACT_SOURCE: Record<string, string> = {
  manual: "Manual", luma: "Luma", notion: "Notion", linkedin: "LinkedIn", ai_tinkerers: "AI Tinkerers",
  demo_form: "Formulario demo", ziora_app: "App Ziora", facebook_group: "Grupo FB", instagram: "Instagram", csv_import: "CSV",
  sheet_import: "Hoja de leads", event_ops: "Event Ops", referral: "Referido",
};

/** Checklist de la sección 5 del brief GTM: debe estar completa para aprobar una pieza. */
export const LEGAL_CHECKLIST = [
  "Digo \"asistente administrativo\", nunca EHR, expediente oficial ni sistema certificado",
  "Digo \"te deja listo para cumplir\", nunca \"Ziora cumple la NOM-004\"",
  "Todo lo de la IA es un borrador que el terapeuta revisa y aprueba",
  "Nunca \"predice\", \"detecta riesgo suicida\" ni diagnostica",
  "\"Seguridad de grado clínico\"; nunca HIPAA, SOC 2 ni certificado",
  "WhatsApp: solo \"botones\", sin recordatorios automáticos",
  "Cada cifra lleva fuente y país (si es de EE. UU., lo digo)",
  "Sin datos, casos ni frases de pacientes, ni inventados",
  "Sin humor sobre suicidio, crisis ni diagnósticos",
  "CTA vigente según la regla 2.4 (sin \"14 días sin tarjeta\" hasta confirmar)",
] as const;

export const OPS_ROLE = {
  ceo: { label: "CEO", tone: "green" },
  sales: { label: "Ventas", tone: "amber" },
  clinical_director: { label: "Director clínico", tone: "blue" },
  marketing: { label: "Marketing", tone: "lilac" },
  operations: { label: "Operaciones", tone: "gray" },
  dev_qa: { label: "Dev / QA", tone: "red" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const SUGGESTION_STATUS = {
  new: { label: "Nueva", tone: "blue" },
  accepted: { label: "Aceptada", tone: "green" },
  rejected: { label: "Descartada", tone: "gray" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const TICKET_KIND = {
  bug: { label: "Algo no funciona", tone: "red" },
  change: { label: "Cambio", tone: "blue" },
  feature: { label: "Idea nueva", tone: "lilac" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const TICKET_STATUS = {
  new: { label: "Nuevo", tone: "blue" },
  evaluating: { label: "Evaluando", tone: "amber" },
  planned: { label: "Planeado", tone: "lilac" },
  in_progress: { label: "En curso", tone: "blue" },
  done: { label: "Listo", tone: "green" },
  rejected: { label: "No se hará", tone: "gray" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const VIABILITY = {
  pending: { label: "Sin evaluar", tone: "gray" },
  viable: { label: "Viable", tone: "green" },
  not_viable: { label: "No viable", tone: "red" },
  needs_info: { label: "Falta información", tone: "amber" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const EFFORT = { s: "S · horas", m: "M · 1–2 días", l: "L · semana", xl: "XL · varias semanas" } as const;

export const TICKET_ORIGIN = { team: "Equipo", ziora_app_help: "App · Ayuda y sugerencias" } as const;

export const ACCOUNT_TYPE = {
  clinic: "Clínica", university: "Universidad", hospital: "Hospital", institution: "Institución", other: "Otro",
} as const;

export const DEAL_STAGE = {
  prospect: { label: "Prospecto", tone: "gray" },
  meeting: { label: "Reunión", tone: "blue" },
  proposal: { label: "Propuesta", tone: "lilac" },
  negotiation: { label: "Negociación", tone: "amber" },
  won: { label: "Ganada", tone: "green" },
  lost: { label: "Perdida", tone: "red" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const CONTRACT_STATUS = {
  draft: { label: "Borrador", tone: "gray" },
  sent: { label: "Enviado", tone: "blue" },
  signed: { label: "Firmado", tone: "lilac" },
  active: { label: "Activo", tone: "green" },
  expired: { label: "Vencido", tone: "red" },
  cancelled: { label: "Cancelado", tone: "gray" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const BILLING_PERIOD = { monthly: "Mensual", annual: "Anual", one_time: "Pago único" } as const;

export const FOLLOWUP_CHANNEL = { call: "Llamada", whatsapp: "WhatsApp", email: "Correo", video: "Videollamada", in_person: "En persona" } as const;

export const HEALTH = {
  green: { label: "Bien", tone: "green" },
  yellow: { label: "Atención", tone: "amber" },
  red: { label: "En riesgo", tone: "red" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const FOLLOWUP_REASON: Record<string, string> = {
  manual: "Agendado", paying_inactive: "Sugerido: pago sin actividad", trial_ending: "Sugerido: trial por vencer",
};

export const SOCIAL_PLATFORM = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn" } as const;

export const LEAD_STATUS = {
  nuevo: { label: "Nuevo", tone: "gray" },
  contactado: { label: "Contactado", tone: "blue" },
  respondio: { label: "Respondió", tone: "lilac" },
  demo_agendada: { label: "Demo agendada", tone: "blue" },
  en_trial: { label: "En trial", tone: "amber" },
  pago: { label: "Pagó", tone: "green" },
  perdido: { label: "Perdido", tone: "red" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const LEAD_PRIORITY = {
  1: { label: "HOT", tone: "red" },
  2: { label: "WARM", tone: "amber" },
  3: { label: "COLD", tone: "gray" },
} as const satisfies Record<number, { label: string; tone: Tone }>;

export const ACTIVITY_TYPE = {
  nota: "Nota", whatsapp: "WhatsApp", correo: "Correo", llamada: "Llamada", reunion: "Reunión",
  cambio_estado: "Cambio de estado", demo: "Demo", campana: "Campaña", secuencia: "Secuencia", sistema: "Sistema",
} as const;
