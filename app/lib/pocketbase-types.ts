/**
 * This file was @generated from PocketBase schema (data.db).
 */

import type PocketBase from 'pocketbase'
import type { RecordService } from 'pocketbase'

export enum Collections {
  AuthOrigins = "_authOrigins",
  ExternalAuths = "_externalAuths",
  Mfas = "_mfas",
  Otps = "_otps",
  Superusers = "_superusers",
  AuditLogs = "audit_logs",
  Avvocati = "avvocati",
  CompetenzaOpzioni = "competenza_opzioni",
  Convocazioni = "convocazioni",
  DashboardApertePerMediatore = "dashboard_aperte_per_mediatore",
  DashboardChiusePerEsitoMese = "dashboard_chiuse_per_esito_mese",
  DashboardMediatoreStats = "dashboard_mediatore_stats",
  DashboardMediazioniPerMese = "dashboard_mediazioni_per_mese",
  DashboardTassiMensili = "dashboard_tassi_mensili",
  Documenti = "documenti",
  DocumentiTipi = "documenti_tipi",
  Fatture = "fatture",
  Incontri = "incontri",
  MateriaOpzioni = "materia_opzioni",
  Mediazioni = "mediazioni",
  MediazioniView = "mediazioni_view",
  ModalitaConvocazioneOpzioni = "modalita_convocazione_opzioni",
  ModalitaOpzioni = "modalita_opzioni",
  ModelliDocumenti = "modelli_documenti",
  MotivazioneDepositoOpzioni = "motivazione_deposito_opzioni",
  Notifiche = "notifiche",
  Partecipazioni = "partecipazioni",
  ScaglioniMediazione = "scaglioni_mediazione",
  Soggetti = "soggetti",
  Users = "users",
}

export type IsoDateString = string
export type RecordIdString = string
export type HTMLString = string

type ExpandType<T> = unknown extends T
  ? T extends unknown
    ? { expand?: unknown }
    : { expand: T }
  : { expand: T }

export type BaseSystemFields<T = unknown> = {
  id: RecordIdString
  collectionId: string
  collectionName: Collections
} & ExpandType<T>

export type AuthSystemFields<T = unknown> = {
  email: string
  emailVisibility: boolean
  username: string
  verified: boolean
} & BaseSystemFields<T>

export enum AuditLogsEventTypeOptions {
  "create" = "create",
  "update" = "update",
  "delete" = "delete",
  "create_request" = "create_request",
  "update_request" = "update_request",
  "delete_request" = "delete_request",
  "auth" = "auth",
}

export enum ConvocazioniTipologiaOptions {
  "PEC" = "PEC",
  "Raccomandata" = "Raccomandata",
}

export enum DashboardChiusePerEsitoMeseEsitoFinaleOptions {
  "Accordo" = "Accordo",
  "Mancato accordo" = "Mancato accordo",
  "Chiusa d'ufficio" = "Chiusa d'ufficio",
  "Ritirata" = "Ritirata",
  "Nessuna risposta" = "Nessuna risposta",
  "Non consegnabile" = "Non consegnabile",
  "Nessuna adesione" = "Nessuna adesione",
}

export enum MediazioniEsitoFinaleOptions {
  "Accordo" = "Accordo",
  "Mancato accordo" = "Mancato accordo",
  "Chiusa d'ufficio" = "Chiusa d'ufficio",
  "Ritirata" = "Ritirata",
  "Nessuna risposta" = "Nessuna risposta",
  "Non consegnabile" = "Non consegnabile",
  "Nessuna adesione" = "Nessuna adesione",
}

export enum MediazioniStatoOptions {
  "registrata" = "registrata",
  "assegnata" = "assegnata",
  "da_notificare" = "da_notificare",
  "aperta" = "aperta",
}

export enum MediazioniViewEsitoFinaleOptions {
  "Accordo" = "Accordo",
  "Mancato accordo" = "Mancato accordo",
  "Chiusa d'ufficio" = "Chiusa d'ufficio",
  "Ritirata" = "Ritirata",
  "Nessuna risposta" = "Nessuna risposta",
  "Non consegnabile" = "Non consegnabile",
  "Nessuna adesione" = "Nessuna adesione",
}

export enum MediazioniViewStatoOptions {
  "registrata" = "registrata",
  "assegnata" = "assegnata",
  "da_notificare" = "da_notificare",
  "aperta" = "aperta",
}

export enum NotificheTipoOptions {
  "assegnazione" = "assegnazione",
  "riassegnazione" = "riassegnazione",
  "adesione" = "adesione",
}

export enum PartecipazioniIstanteOChiamatoOptions {
  "Istante" = "Istante",
  "Chiamato" = "Chiamato",
}

export enum SoggettiTipoOptions {
  "Fisica" = "Fisica",
  "Giuridica" = "Giuridica",
}

export enum UsersRuoliOptions {
  "admin" = "admin",
  "manager" = "manager",
  "mediatore" = "mediatore",
  "Ospite" = "Ospite",
}

export enum UsersRuoloCorrenteOptions {
  "admin" = "admin",
  "manager" = "manager",
  "mediatore" = "mediatore",
  "Ospite" = "Ospite",
}

// Record types for each collection

export type AuthOriginsRecord = {
  id: string
  collectionRef: string
  recordRef: string
  fingerprint: string
  created?: IsoDateString
  updated?: IsoDateString
}
export type ExternalAuthsRecord = {
  id: string
  collectionRef: string
  recordRef: string
  provider: string
  providerId: string
  created?: IsoDateString
  updated?: IsoDateString
}
export type MfasRecord = {
  id: string
  collectionRef: string
  recordRef: string
  method: string
  created?: IsoDateString
  updated?: IsoDateString
}
export type OtpsRecord = {
  id: string
  collectionRef: string
  recordRef: string
  password: string
  sentTo?: string
  created?: IsoDateString
  updated?: IsoDateString
}
export type SuperusersRecord = {
  id: string
  password: string
  tokenKey: string
  email: string
  emailVisibility?: boolean
  verified?: boolean
  created?: IsoDateString
  updated?: IsoDateString
}
export type AuditLogsRecord = {
  id: string
  event_type: AuditLogsEventTypeOptions
  collection_name: string
  record_id: string
  user_id?: string
  auth_method?: string
  request_method?: string
  request_ip?: string
  request_url?: string
  timestamp: IsoDateString
  before_changes?: string
  after_changes?: string
  created?: IsoDateString
  updated?: IsoDateString
}
export type AvvocatiRecord = {
  id: string
  nome?: string
  cognome?: string
  pec?: string
  telefono?: string
  numero_tessera_foro?: string
  foro_di_appartenenza?: string
}
export type CompetenzaOpzioniRecord = {
  id: string
  nome: string
  attivo?: boolean
  created?: IsoDateString
  updated?: IsoDateString
}
export type ConvocazioniRecord = {
  id: string
  partecipazione?: RecordIdString
  data_caricamento?: IsoDateString
  data_invio?: IsoDateString
  tipologia?: ConvocazioniTipologiaOptions
  numero_raccomandata?: string
  link_tracciamento_poste?: string
  nota?: string
  link_legacy?: string
}
export type DashboardApertePerMediatoreRecord = {
  id: string
  mediatore?: RecordIdString
  mediatore_name?: string
  cnt?: number
}
export type DashboardChiusePerEsitoMeseRecord = {
  id: string
  mediatore?: RecordIdString
  esito_finale?: DashboardChiusePerEsitoMeseEsitoFinaleOptions
  mese_chiusura?: string
  cnt?: number
}
export type DashboardMediatoreStatsRecord = {
  id: string
  mediatore?: RecordIdString
  mediatore_name?: string
  aperte?: string
  in_corso?: string
  chiuse?: string
  accordo?: string
  mancato_accordo?: string
  improcedibile?: string
  chiusa_ufficio?: string
}
export type DashboardMediazioniPerMeseRecord = {
  id: string
  mediatore?: RecordIdString
  mese?: string
  cnt?: number
}
export type DashboardTassiMensiliRecord = {
  id: string
  mediatore?: string
  mese?: string
  totale?: string
  con_incontro?: string
  accordo?: string
  tasso_adesione?: string
  tasso_esito_positivo?: string
}
export type DocumentiRecord = {
  id: string
  mediazione?: RecordIdString
  tipo?: RecordIdString
  descrizione?: string
  file?: string
  link_legacy?: string
}
export type DocumentiTipiRecord = {
  id: string
  nome: string
  descrizione?: string
  attivo?: boolean
  created?: IsoDateString
  updated?: IsoDateString
}
export type FattureRecord = {
  id: string
  mediazione: RecordIdString
  partecipazione?: RecordIdString
  numero_fattura?: string
  data_emissione_fattura?: IsoDateString
  data_incasso?: IsoDateString
  imponibile?: number
  nota?: string
}
export type IncontriRecord = {
  id: string
  mediazione: RecordIdString
  data_programmazione?: IsoDateString
  data_inizio_effettiva?: IsoDateString
  data_fine_effettiva?: IsoDateString
  link_incontro?: string
  report?: HTMLString
  verbale?: string
  link_legacy?: string
}
export type MateriaOpzioniRecord = {
  id: string
  nome: string
  attivo: boolean
  created?: IsoDateString
  updated?: IsoDateString
}
export type MediazioniRecord = {
  id: string
  rgm?: string
  data_deposito?: IsoDateString
  data_protocollo?: IsoDateString
  mediatore?: RecordIdString
  oggetto?: string
  valore?: string
  competenza?: string
  modalita_mediazione?: string
  motivazione_deposito?: string
  modalita_convocazione?: string
  data_avvio_entro?: IsoDateString
  esito_finale?: MediazioniEsitoFinaleOptions
  data_chiusura?: IsoDateString
  nota?: HTMLString
  is_deleted?: boolean
  deleted_at?: IsoDateString
  deleted_by?: string
  stato?: MediazioniStatoOptions
  data_assegnazione?: IsoDateString
  codice_univoco_cliente?: string
  adesione?: boolean
  trasmessa?: boolean
  proposta_mediatore?: boolean
  numero_esonerati_gratuito_patrocinio?: number
  materia_altro?: string
  created?: IsoDateString
  updated?: IsoDateString
}
export type MediazioniViewRecord = {
  id: string
  rgm?: string
  oggetto?: string
  data_deposito?: IsoDateString
  data_protocollo?: IsoDateString
  data_chiusura?: IsoDateString
  mediatore?: RecordIdString
  modalita_mediazione?: string
  esito_finale?: MediazioniViewEsitoFinaleOptions
  valore?: string
  competenza?: string
  nota?: HTMLString
  stato?: MediazioniViewStatoOptions
  data_assegnazione?: IsoDateString
  codice_univoco_cliente?: string
  created?: IsoDateString
  updated?: IsoDateString
  adesione?: boolean
  trasmessa?: boolean
  proposta_mediatore?: boolean
  numero_esonerati_gratuito_patrocinio?: number
  materia_altro?: string
  mediatore_name: string
  istanti_testo?: string
  chiamati_testo?: string
  avvocati_testo?: string
}
export type ModalitaConvocazioneOpzioniRecord = {
  id: string
  nome: string
  attivo: boolean
  created?: IsoDateString
  updated?: IsoDateString
}
export type ModalitaOpzioniRecord = {
  id: string
  nome: string
  attivo?: boolean
  created?: IsoDateString
  updated?: IsoDateString
}
export type ModelliDocumentiRecord = {
  id: string
  nome: string
  descrizione?: string
  file: string
  attivo?: boolean
  created?: IsoDateString
  updated?: IsoDateString
}
export type MotivazioneDepositoOpzioniRecord = {
  id: string
  nome: string
  attivo: boolean
  created?: IsoDateString
  updated?: IsoDateString
}
export type NotificheRecord = {
  id: string
  destinatario: RecordIdString
  attore?: RecordIdString
  tipo: NotificheTipoOptions
  messaggio: string
  dettaglio?: string
  letto?: boolean
  count?: number
  mediazioni?: RecordIdString[]
  created?: IsoDateString
  updated?: IsoDateString
}
export type PartecipazioniRecord = {
  id: string
  mediazione: RecordIdString
  soggetto: RecordIdString
  istante_o_chiamato?: PartecipazioniIstanteOChiamatoOptions
  avvocati?: RecordIdString[]
}
export type ScaglioniMediazioneRecord = {
  id: string
  nome: string
  descrizione?: string
  attivo?: boolean
  created?: IsoDateString
  updated?: IsoDateString
}
export type SoggettiRecord = {
  id: string
  tipo: SoggettiTipoOptions
  nome?: string
  cognome?: string
  codice_fiscale?: string
  indirizzo_riga_1?: string
  indirizzo_riga_2?: string
  numero_civico?: string
  comune?: string
  provincia?: string
  cap?: string
  paese?: string
  email?: string
  ragione_sociale?: string
  piva?: string
  pec?: string
}
export type UsersRecord = {
  id: string
  name: string
  avatar?: string
  sesso?: "male" | "female" | string
  firma?: string
  stato?: string
  ruoli?: UsersRuoliOptions
  ruolo_corrente: UsersRuoloCorrenteOptions
  password: string
  tokenKey: string
  email: string
  emailVisibility?: boolean
  verified?: boolean
}

// Response types include system fields

export type AuthOriginsResponse<Texpand = unknown> = Required<AuthOriginsRecord> & BaseSystemFields<Texpand>
export type ExternalAuthsResponse<Texpand = unknown> = Required<ExternalAuthsRecord> & BaseSystemFields<Texpand>
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> & BaseSystemFields<Texpand>
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> & BaseSystemFields<Texpand>
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> & AuthSystemFields<Texpand>
export type AuditLogsResponse<Texpand = unknown> = Required<AuditLogsRecord> & BaseSystemFields<Texpand>
export type AvvocatiResponse<Texpand = unknown> = Required<AvvocatiRecord> & BaseSystemFields<Texpand>
export type CompetenzaOpzioniResponse<Texpand = unknown> = Required<CompetenzaOpzioniRecord> & BaseSystemFields<Texpand>
export type ConvocazioniResponse<Texpand = unknown> = Required<ConvocazioniRecord> & BaseSystemFields<Texpand>
export type DashboardApertePerMediatoreResponse<Texpand = unknown> = Required<DashboardApertePerMediatoreRecord> & BaseSystemFields<Texpand>
export type DashboardChiusePerEsitoMeseResponse<Texpand = unknown> = Required<DashboardChiusePerEsitoMeseRecord> & BaseSystemFields<Texpand>
export type DashboardMediatoreStatsResponse<Texpand = unknown> = Required<DashboardMediatoreStatsRecord> & BaseSystemFields<Texpand>
export type DashboardMediazioniPerMeseResponse<Texpand = unknown> = Required<DashboardMediazioniPerMeseRecord> & BaseSystemFields<Texpand>
export type DashboardTassiMensiliResponse<Texpand = unknown> = Required<DashboardTassiMensiliRecord> & BaseSystemFields<Texpand>
export type DocumentiResponse<Texpand = unknown> = Required<DocumentiRecord> & BaseSystemFields<Texpand>
export type DocumentiTipiResponse<Texpand = unknown> = Required<DocumentiTipiRecord> & BaseSystemFields<Texpand>
export type FattureResponse<Texpand = unknown> = Required<FattureRecord> & BaseSystemFields<Texpand>
export type IncontriResponse<Texpand = unknown> = Required<IncontriRecord> & BaseSystemFields<Texpand>
export type MateriaOpzioniResponse<Texpand = unknown> = Required<MateriaOpzioniRecord> & BaseSystemFields<Texpand>
export type MediazioniResponse<Texpand = unknown> = Required<MediazioniRecord> & BaseSystemFields<Texpand>
export type MediazioniViewResponse<Texpand = unknown> = Required<MediazioniViewRecord> & BaseSystemFields<Texpand>
export type ModalitaConvocazioneOpzioniResponse<Texpand = unknown> = Required<ModalitaConvocazioneOpzioniRecord> & BaseSystemFields<Texpand>
export type ModalitaOpzioniResponse<Texpand = unknown> = Required<ModalitaOpzioniRecord> & BaseSystemFields<Texpand>
export type ModelliDocumentiResponse<Texpand = unknown> = Required<ModelliDocumentiRecord> & BaseSystemFields<Texpand>
export type MotivazioneDepositoOpzioniResponse<Texpand = unknown> = Required<MotivazioneDepositoOpzioniRecord> & BaseSystemFields<Texpand>
export type NotificheResponse<Texpand = unknown> = Required<NotificheRecord> & BaseSystemFields<Texpand>
export type PartecipazioniResponse<Texpand = unknown> = Required<PartecipazioniRecord> & BaseSystemFields<Texpand>
export type ScaglioniMediazioneResponse<Texpand = unknown> = Required<ScaglioniMediazioneRecord> & BaseSystemFields<Texpand>
export type SoggettiResponse<Texpand = unknown> = Required<SoggettiRecord> & BaseSystemFields<Texpand>
export type UsersResponse<Texpand = unknown> = Required<UsersRecord> & AuthSystemFields<Texpand>

export type CollectionRecords = {
  "_authOrigins": AuthOriginsRecord
  "_externalAuths": ExternalAuthsRecord
  "_mfas": MfasRecord
  "_otps": OtpsRecord
  "_superusers": SuperusersRecord
  "audit_logs": AuditLogsRecord
  "avvocati": AvvocatiRecord
  "competenza_opzioni": CompetenzaOpzioniRecord
  "convocazioni": ConvocazioniRecord
  "dashboard_aperte_per_mediatore": DashboardApertePerMediatoreRecord
  "dashboard_chiuse_per_esito_mese": DashboardChiusePerEsitoMeseRecord
  "dashboard_mediatore_stats": DashboardMediatoreStatsRecord
  "dashboard_mediazioni_per_mese": DashboardMediazioniPerMeseRecord
  "dashboard_tassi_mensili": DashboardTassiMensiliRecord
  "documenti": DocumentiRecord
  "documenti_tipi": DocumentiTipiRecord
  "fatture": FattureRecord
  "incontri": IncontriRecord
  "materia_opzioni": MateriaOpzioniRecord
  "mediazioni": MediazioniRecord
  "mediazioni_view": MediazioniViewRecord
  "modalita_convocazione_opzioni": ModalitaConvocazioneOpzioniRecord
  "modalita_opzioni": ModalitaOpzioniRecord
  "modelli_documenti": ModelliDocumentiRecord
  "motivazione_deposito_opzioni": MotivazioneDepositoOpzioniRecord
  "notifiche": NotificheRecord
  "partecipazioni": PartecipazioniRecord
  "scaglioni_mediazione": ScaglioniMediazioneRecord
  "soggetti": SoggettiRecord
  "users": UsersRecord
}

export type CollectionResponses = {
  "_authOrigins": AuthOriginsResponse
  "_externalAuths": ExternalAuthsResponse
  "_mfas": MfasResponse
  "_otps": OtpsResponse
  "_superusers": SuperusersResponse
  "audit_logs": AuditLogsResponse
  "avvocati": AvvocatiResponse
  "competenza_opzioni": CompetenzaOpzioniResponse
  "convocazioni": ConvocazioniResponse
  "dashboard_aperte_per_mediatore": DashboardApertePerMediatoreResponse
  "dashboard_chiuse_per_esito_mese": DashboardChiusePerEsitoMeseResponse
  "dashboard_mediatore_stats": DashboardMediatoreStatsResponse
  "dashboard_mediazioni_per_mese": DashboardMediazioniPerMeseResponse
  "dashboard_tassi_mensili": DashboardTassiMensiliResponse
  "documenti": DocumentiResponse
  "documenti_tipi": DocumentiTipiResponse
  "fatture": FattureResponse
  "incontri": IncontriResponse
  "materia_opzioni": MateriaOpzioniResponse
  "mediazioni": MediazioniResponse
  "mediazioni_view": MediazioniViewResponse
  "modalita_convocazione_opzioni": ModalitaConvocazioneOpzioniResponse
  "modalita_opzioni": ModalitaOpzioniResponse
  "modelli_documenti": ModelliDocumentiResponse
  "motivazione_deposito_opzioni": MotivazioneDepositoOpzioniResponse
  "notifiche": NotificheResponse
  "partecipazioni": PartecipazioniResponse
  "scaglioni_mediazione": ScaglioniMediazioneResponse
  "soggetti": SoggettiResponse
  "users": UsersResponse
}

export type TypedPocketBase = PocketBase & {
  collection<T extends keyof CollectionResponses>(idOrName: T): RecordService<CollectionResponses[T]>
}
