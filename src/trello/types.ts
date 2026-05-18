export interface Board {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  url: string;
  shortUrl: string;
  idOrganization: string | null;
  dateLastActivity: string | null;
}

export interface List {
  id: string;
  name: string;
  closed: boolean;
  idBoard: string;
  pos: number;
}

export interface Card {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  idBoard: string;
  idList: string;
  due: string | null;
  dueComplete: boolean;
  idMembers: string[];
  idLabels: string[];
  url: string;
  shortUrl: string;
  pos: number;
}

export interface Webhook {
  id: string;
  description: string;
  idModel: string;
  callbackURL: string;
  active: boolean;
}

export interface Member {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
}

export interface OAuthTokenPair {
  token: string;
  tokenSecret: string;
}

export interface PersistedAuth extends OAuthTokenPair {
  consumerKey: string;
  obtainedAt: string;
  scope: string;
  expiration: string;
}
