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

export interface Attachment {
  id: string;
  name: string;
  url: string;
  bytes: number | null;
  date: string;
  mimeType: string | null;
  isUpload: boolean;
  idMember: string;
  pos: number;
}

export interface CheckItem {
  id: string;
  name: string;
  state: "complete" | "incomplete";
  idChecklist: string;
  pos: number;
  due: string | null;
  idMember: string | null;
}

export interface Checklist {
  id: string;
  name: string;
  idCard: string;
  idBoard: string;
  pos: number;
  checkItems: CheckItem[];
}

export interface CommentAction {
  id: string;
  type: string;
  date: string;
  idMemberCreator: string;
  data: {
    text: string;
    card?: { id: string; name: string };
  };
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
