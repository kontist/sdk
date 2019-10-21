import * as ClientOAuth2 from "client-oauth2";

export type ClientOpts = {
  baseUrl?: string;
  clientId: string;
  oauthClient?: ClientOAuth2;
  redirectUri: string;
  scopes: string[];
  state: string;
  verifier?: string;
};

export type GetAuthUriOpts = {
  verifier?: string;
};

export type GetTokenOpts = {
  verifier?: string;
};
