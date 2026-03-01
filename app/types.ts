export type PbUser = {
  id: string;
  email: string;
  name: string;
  stato?: boolean;
  ruoli?: string[];
  ruolo_corrente?: string;
  avatar?: string;
};
