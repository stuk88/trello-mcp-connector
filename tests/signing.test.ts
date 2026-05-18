import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSignatureBaseString,
  parseOAuthFormBody,
  rfc3986Encode,
  signRequest,
} from "../src/trello/signing.js";

/**
 * Fixture derived from the worked example in Twitter's OAuth 1.0a docs
 * (https://developer.twitter.com/en/docs/authentication/oauth-1-0a/creating-a-signature),
 * which matches the RFC 5849 §3.4 procedure. We use the base string from
 * that doc as a golden value; the expected signature is recomputed
 * independently from the same base string + signing key so the test stays
 * internally consistent regardless of which historical version of the doc
 * you cross-reference.
 */
const twitterFixture = {
  consumerKey: "xvz1evFS4wEEPTGEFPHBog",
  consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  timestamp: "1318622958",
  url: "https://api.twitter.com/1/statuses/update.json?include_entities=true",
  status: "Hello Ladies + Gentlemen, a signed OAuth request!",
  expectedBaseString:
    "POST&https%3A%2F%2Fapi.twitter.com%2F1%2Fstatuses%2Fupdate.json&" +
    "include_entities%3Dtrue%26" +
    "oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26" +
    "oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26" +
    "oauth_signature_method%3DHMAC-SHA1%26" +
    "oauth_timestamp%3D1318622958%26" +
    "oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26" +
    "oauth_version%3D1.0%26" +
    "status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521",
};

function expectedSignatureFor(baseString: string, consumerSecret: string, tokenSecret: string): string {
  const key = `${consumerSecret}&${tokenSecret}`;
  return createHmac("sha1", key).update(baseString).digest("base64");
}

describe("rfc3986Encode", () => {
  it("encodes per RFC 3986 (unreserved chars unchanged, all others percent-encoded)", () => {
    expect(rfc3986Encode("abcABC123-._~")).toBe("abcABC123-._~");
    expect(rfc3986Encode(" ")).toBe("%20");
    expect(rfc3986Encode("+")).toBe("%2B");
    expect(rfc3986Encode("/")).toBe("%2F");
    expect(rfc3986Encode("=")).toBe("%3D");
    expect(rfc3986Encode("!")).toBe("%21");
    expect(rfc3986Encode("*")).toBe("%2A");
    expect(rfc3986Encode("'")).toBe("%27");
    expect(rfc3986Encode("(")).toBe("%28");
    expect(rfc3986Encode(")")).toBe("%29");
  });
});

describe("buildSignatureBaseString", () => {
  it("matches the Twitter / RFC 5849 §3.4 worked example", () => {
    const { baseString } = buildSignatureBaseString({
      method: "POST",
      url: twitterFixture.url,
      params: { status: twitterFixture.status },
      oauthParams: {
        oauth_consumer_key: twitterFixture.consumerKey,
        oauth_nonce: twitterFixture.nonce,
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: twitterFixture.timestamp,
        oauth_token: twitterFixture.token,
        oauth_version: "1.0",
      },
    });
    expect(baseString).toBe(twitterFixture.expectedBaseString);
  });
});

describe("signRequest", () => {
  it("produces an HMAC-SHA1 signature consistent with the documented base string", () => {
    const signed = signRequest(
      {
        consumerKey: twitterFixture.consumerKey,
        consumerSecret: twitterFixture.consumerSecret,
        token: twitterFixture.token,
        tokenSecret: twitterFixture.tokenSecret,
      },
      {
        method: "POST",
        url: twitterFixture.url,
        params: { status: twitterFixture.status },
        nonce: twitterFixture.nonce,
        timestamp: twitterFixture.timestamp,
      },
    );
    // Pull the signature out of the Authorization header.
    const match = signed.authorization.match(/oauth_signature="([^"]+)"/);
    expect(match).not.toBeNull();
    const decoded = decodeURIComponent(match![1]!);
    const expected = expectedSignatureFor(
      twitterFixture.expectedBaseString,
      twitterFixture.consumerSecret,
      twitterFixture.tokenSecret,
    );
    expect(decoded).toBe(expected);
  });

  it("changes the signature when the token secret changes (no key smuggling)", () => {
    const opts = {
      method: "POST",
      url: twitterFixture.url,
      params: { status: twitterFixture.status },
      nonce: twitterFixture.nonce,
      timestamp: twitterFixture.timestamp,
    };
    const a = signRequest(
      {
        consumerKey: twitterFixture.consumerKey,
        consumerSecret: twitterFixture.consumerSecret,
        token: twitterFixture.token,
        tokenSecret: twitterFixture.tokenSecret,
      },
      opts,
    );
    const b = signRequest(
      {
        consumerKey: twitterFixture.consumerKey,
        consumerSecret: twitterFixture.consumerSecret,
        token: twitterFixture.token,
        tokenSecret: "different-token-secret",
      },
      opts,
    );
    const sigA = a.authorization.match(/oauth_signature="([^"]+)"/)![1];
    const sigB = b.authorization.match(/oauth_signature="([^"]+)"/)![1];
    expect(sigA).not.toBe(sigB);
  });

  it("includes oauth_callback in the signature when supplied (request-token flow)", () => {
    const signed = signRequest(
      {
        consumerKey: "key",
        consumerSecret: "secret",
      },
      {
        method: "POST",
        url: "https://example.com/oauth",
        extraOAuth: { oauth_callback: "http://localhost:1234/cb" },
        nonce: "nonce",
        timestamp: "1",
      },
    );
    expect(signed.authorization).toMatch(/oauth_callback="http%3A%2F%2Flocalhost%3A1234%2Fcb"/);
    expect(signed.authorization).toMatch(/oauth_signature="[^"]+"/);
  });
});

describe("parseOAuthFormBody", () => {
  it("decodes urlencoded key/value pairs", () => {
    const parsed = parseOAuthFormBody(
      "oauth_token=abc&oauth_token_secret=xyz%20with%20space&oauth_callback_confirmed=true",
    );
    expect(parsed).toEqual({
      oauth_token: "abc",
      oauth_token_secret: "xyz with space",
      oauth_callback_confirmed: "true",
    });
  });
});
