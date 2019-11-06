import * as ClientOAuth2 from "client-oauth2";
import { sha256 } from "js-sha256";
import { btoa } from "abab";
import {
  ClientOpts,
  Challenge,
  ChallengeStatus,
  HttpMethod,
  CreateDeviceParams,
  CreateDeviceResult,
  VerifyDeviceParams,
  DeviceChallenge,
  VerifyDeviceChallengeParams,
  VerifyDeviceChallengeResult,
  GetAuthUriOpts,
  TimeoutID
} from "./types";
import { authorizeSilently } from "./utils";
import {
  ChallengeExpiredError,
  ChallengeDeniedError,
  MFAConfirmationCanceledError,
  UserUnauthorizedError,
  SilentAuthorizationError,
  KontistSDKError
} from "./errors";

import "cross-fetch/polyfill";

export const MFA_CHALLENGE_PATH = "/api/user/mfa/challenges";
export const CREATE_DEVICE_PATH = "/api/user/devices";
export const VERIFY_DEVICE_PATH = (deviceId: string) =>
  `/api/user/devices/${deviceId}/verify`;
export const CREATE_DEVICE_CHALLENGE_PATH = (deviceId: string) =>
  `/api/user/devices/${deviceId}/challenges`;
export const VERIFY_DEVICE_CHALLENGE_PATH = (
  deviceId: string,
  challengeId: string
) => `/api/user/devices/${deviceId}/challenges/${challengeId}/verify`;

const CHALLENGE_POLL_INTERVAL = 3000;

const HTTP_STATUS_NO_CONTENT = 204;

export class Auth {
  private oauth2Client: ClientOAuth2;
  private _token: ClientOAuth2.Token | null = null;
  private baseUrl: string;
  private state?: string;
  private verifier?: string;
  private challengePollInterval: number = CHALLENGE_POLL_INTERVAL;
  private challengePollTimeoutId?: TimeoutID;
  private rejectMFAConfirmation: Function | null = null;

  /**
   * Client OAuth2 module instance.
   *
   * @param baseUrl  Kontist API base url
   * @param opts     OAuth2 client data including at least clientId, redirectUri,
   *                 scopes, state and clientSecret or code verifier (for PKCE).
   * @throws         throws when both clientSecret and code verifier are provided
   */
  constructor(baseUrl: string, opts: ClientOpts) {
    const {
      clientId,
      clientSecret,
      oauthClient,
      redirectUri,
      scopes,
      state,
      verifier
    } = opts;
    this.verifier = verifier;
    this.baseUrl = baseUrl;
    this.state = state;

    if (verifier && clientSecret) {
      throw new KontistSDKError({
        message:
          "You can provide only one parameter from ['verifier', 'clientSecret']."
      });
    }

    this.oauth2Client =
      oauthClient ||
      new ClientOAuth2({
        accessTokenUri: `${baseUrl}/api/oauth/token`,
        authorizationUri: `${baseUrl}/api/oauth/authorize`,
        clientId,
        clientSecret,
        redirectUri,
        scopes,
        state
      });
  }

  /**
   * Build a uri to which the user must be redirected for login.
   */
  public getAuthUri = async (opts: GetAuthUriOpts = {}): Promise<string> => {
    const query: {
      [key: string]: string | string[];
    } = {
      ...(opts.query || {})
    };

    if (this.verifier) {
      // Implemented according to https://tools.ietf.org/html/rfc7636#appendix-A
      const challenge = (
        btoa(String.fromCharCode.apply(null, sha256.array(this.verifier))) || ""
      )
        .split("=")[0]
        .replace("+", "-")
        .replace("/", "_");

      query.code_challenge = challenge;
      query.code_challenge_method = "S256";
    }

    return this.oauth2Client.code.getUri({ query });
  };

  /**
   * This method must be called during the callback via `redirectUri`.
   *
   * @param callbackUri  `redirectUri` containing OAuth2 data after user authentication
   * @returns            token object which might contain token(s), scope(s), token type and expiration time
   */
  public fetchToken = async (
    callbackUri: string
  ): Promise<ClientOAuth2.Token> => {
    const options: {
      body?: {
        code_verifier: string;
      };
    } = {};

    if (this.verifier) {
      options.body = {
        code_verifier: this.verifier
      };
    }

    const token = await this.oauth2Client.code.getToken(callbackUri, options);

    this._token = token;

    return token;
  };

  /**
   * Fetches token from owner credentials.
   * Only works for client IDs that support the 'password' grant type
   *
   * @param options     Username, password, and an optional set of scopes
   *                    When given a set of scopes, they override the default list of
   *                    scopes of `this` intance
   *
   * @returns           token object which might contain token(s), scope(s), token type and expiration time
   */
  public fetchTokenFromCredentials = async (options: {
    username: string;
    password: string;
    scopes?: string[]
  }) => {
    const getTokenOpts = options.scopes ? { scopes: options.scopes } : {};
    const token = await this.oauth2Client.owner.getToken(options.username, options.password, getTokenOpts);

    this._token = token;

    return token;
  }

  /**
   * Refresh auth token silently for browser environments
   */
  public refreshTokenSilently = async (
    timeout?: number
  ): Promise<ClientOAuth2.Token> => {
    if (!document || !window) {
      throw new SilentAuthorizationError({
        message:
          "Silent auth token refresh is only available in browser environments"
      });
    }

    const iframeUri = await this.getAuthUri({
      query: {
        prompt: "none",
        response_mode: "web_message"
      }
    });

    try {
      const code = await authorizeSilently(iframeUri, this.baseUrl, timeout);
      const fetchTokenUri = `${
        document.location.origin
      }?code=${code}&state=${encodeURIComponent(this.state)}`;
      const token = await this.fetchToken(fetchTokenUri);

      return token;
    } catch (error) {
      throw new SilentAuthorizationError({
        message: error.message
      });
    }
  };

  /**
   * Sets up  previously created token for all upcoming requests.
   *
   * @param accessToken   access token
   * @param refreshToken  optional refresh token
   * @param tokenType     token type
   * @returns             token object which might contain token(s), scope(s), token type and expiration time
   */
  public setToken = (
    accessToken: string,
    refreshToken?: string,
    tokenType?: string
  ): ClientOAuth2.Token => {
    const data = {};
    let token;

    if (tokenType && refreshToken) {
      token = this.oauth2Client.createToken(
        accessToken,
        refreshToken,
        tokenType,
        data
      );
    } else if (refreshToken) {
      token = this.oauth2Client.createToken(accessToken, refreshToken, data);
    } else {
      token = this.oauth2Client.createToken(accessToken, data);
    }

    this._token = token;

    return token;
  };

  /**
   * Perform a request against Kontist REST API
   */
  private request = async (
    path: string,
    method: HttpMethod,
    body?: string | Object
  ) => {
    if (!this.token) {
      throw new UserUnauthorizedError();
    }

    const requestUrl = new URL(path, this.baseUrl).href;

    const response = await fetch(requestUrl, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token.accessToken}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new KontistSDKError({
        status: response.status,
        message: response.statusText
      });
    }

    if (response.status === HTTP_STATUS_NO_CONTENT) {
      return;
    }

    return response.json();
  };

  /**
   * Called by `getMFAConfirmedToken`. Calls itself periodically
   * until the challenge expires or its status is updated
   */
  private pollChallengeStatus = (
    pendingChallenge: Challenge,
    resolve: Function,
    reject: Function
  ) => async () => {
    let challenge;
    try {
      challenge = await this.request(
        `${MFA_CHALLENGE_PATH}/${pendingChallenge.id}`,
        HttpMethod.GET
      );
    } catch (error) {
      return reject(error);
    }

    this.rejectMFAConfirmation = null;

    const hasExpired = new Date(challenge.expiresAt) < new Date();
    const wasDenied = challenge.status === ChallengeStatus.DENIED;
    const wasVerified = challenge.status === ChallengeStatus.VERIFIED;

    if (hasExpired) {
      return reject(new ChallengeExpiredError());
    } else if (wasDenied) {
      return reject(new ChallengeDeniedError());
    } else if (wasVerified) {
      const { token: confirmedToken } = await this.request(
        `${MFA_CHALLENGE_PATH}/${challenge.id}/token`,
        HttpMethod.POST
      );

      const token = this.setToken(confirmedToken);
      return resolve(token);
    }

    this.rejectMFAConfirmation = reject;
    this.challengePollTimeoutId = setTimeout(
      this.pollChallengeStatus(pendingChallenge, resolve, reject),
      this.challengePollInterval
    );
  };

  /**
   * Create an MFA challenge and request a confirmed access token when verified
   */
  public getMFAConfirmedToken = async () => {
    const challenge = await this.request(MFA_CHALLENGE_PATH, HttpMethod.POST);

    return new Promise((resolve, reject) =>
      this.pollChallengeStatus(challenge, resolve, reject)()
    );
  };

  /**
   * Clear pending MFA confirmation
   */
  public cancelMFAConfirmation = () => {
    clearTimeout(this.challengePollTimeoutId as TimeoutID);
    if (typeof this.rejectMFAConfirmation === "function") {
      this.rejectMFAConfirmation(new MFAConfirmationCanceledError());
    }
  };

  /**
   * Create a device and return its `deviceId` and `challengeId` for verification
   */
  public createDevice = (
    params: CreateDeviceParams
  ): Promise<CreateDeviceResult> => {
    return this.request(CREATE_DEVICE_PATH, HttpMethod.POST, params);
  };

  /**
   * Verify the device by providing signed OTP received via SMS
   */
  public verifyDevice = (
    deviceId: string,
    params: VerifyDeviceParams
  ): Promise<void> => {
    return this.request(VERIFY_DEVICE_PATH(deviceId), HttpMethod.POST, params);
  };

  /**
   * Create a device challenge and return string to sign by private key
   */
  public createDeviceChallenge = (
    deviceId: string
  ): Promise<DeviceChallenge> => {
    return this.request(
      CREATE_DEVICE_CHALLENGE_PATH(deviceId),
      HttpMethod.POST
    );
  };

  /**
   * Verify the device challenge and update access token
   */
  public verifyDeviceChallenge = async (
    deviceId: string,
    challengeId: string,
    params: VerifyDeviceChallengeParams
  ): Promise<ClientOAuth2.Token> => {
    const { token: accessToken }: VerifyDeviceChallengeResult = await this.request(
      VERIFY_DEVICE_CHALLENGE_PATH(deviceId, challengeId),
      HttpMethod.POST,
      params
    );
    const { refreshToken } = this._token || {};
    return this.setToken(accessToken, refreshToken);
  };

  /**
   * Returns current token used for API requests.
   *
   * @returns  token object which might contain token(s), scope(s), token type and expiration time
   */
  get token(): ClientOAuth2.Token | null {
    return this._token;
  }
}
