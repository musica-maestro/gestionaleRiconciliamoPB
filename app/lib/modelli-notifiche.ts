/** Fixed model names for da-convocare flusso export (modelli_documenti). */

export const MODELLO_LETTERA_INCARICO_NOME = "Lettera incarico mediatore";

export const MODELLO_CONVOCAZIONE_PF_ACCORDO =
  "Convocazione PF - accordo organismi";
export const MODELLO_CONVOCAZIONE_PF_ART4 =
  "Convocazione PF - art. 4 DLgs 28/2010";
export const MODELLO_CONVOCAZIONE_PG_ACCORDO =
  "Convocazione PG - accordo organismi";
export const MODELLO_CONVOCAZIONE_PG_ART4 =
  "Convocazione PG - art. 4 DLgs 28/2010";
export const MODELLO_MODULO_ADESIONE = "Modulo di adesione";

export const MODELLI_NOTIFICHE_FISSI = [
  {
    nome: MODELLO_CONVOCAZIONE_PF_ACCORDO,
    descrizione:
      "Convocazione persona fisica fuori competenza territoriale (accordo tra organismi).",
  },
  {
    nome: MODELLO_CONVOCAZIONE_PF_ART4,
    descrizione:
      "Convocazione persona fisica con competenza territoriale attiva (art. 4 D.Lgs. 28/2010).",
  },
  {
    nome: MODELLO_CONVOCAZIONE_PG_ACCORDO,
    descrizione:
      "Convocazione persona giuridica fuori competenza territoriale (accordo tra organismi).",
  },
  {
    nome: MODELLO_CONVOCAZIONE_PG_ART4,
    descrizione:
      "Convocazione persona giuridica con competenza territoriale attiva (art. 4 D.Lgs. 28/2010).",
  },
  {
    nome: MODELLO_MODULO_ADESIONE,
    descrizione: "Modulo di adesione allegato alla convocazione (PDF unificato).",
  },
] as const;

export const MODELLI_NOTIFICHE_NOMI = MODELLI_NOTIFICHE_FISSI.map((m) => m.nome);

/** Tipi documento accettati come istanza/richiesta da allegare al PDF. */
export const TIPO_DOCUMENTO_ISTANZA = "Istanza";
export const TIPI_DOCUMENTO_ISTANZA = [
  "Istanza",
  "Richiesta di Mediazione",
  "Richiesta di mediazione",
] as const;

