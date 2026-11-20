import crypto from 'crypto';

export interface JsonWebKeyItem {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

export interface JwksDocument {
  keys: JsonWebKeyItem[];
}

export class KeyManager {
  private static privateKeyPem: string | null = null;
  private static publicKeyPem: string | null = null;
  private static keyId: string = 'cvit-auth-key-2026-1';

  /**
   * Initializes or gets the RSA 2048-bit asymmetric keypair.
   * If PLATFORM_PRIVATE_KEY is supplied via env, it is used.
   * Otherwise, generates a secure in-memory RSA keypair for runtime/testing.
   */
  public static ensureKeyPair(): { privateKey: string; publicKey: string; kid: string } {
    if (this.privateKeyPem && this.publicKeyPem) {
      return { privateKey: this.privateKeyPem, publicKey: this.publicKeyPem, kid: this.keyId };
    }

    if (process.env.PLATFORM_PRIVATE_KEY && process.env.PLATFORM_PUBLIC_KEY) {
      this.privateKeyPem = process.env.PLATFORM_PRIVATE_KEY.replace(/\\n/g, '\n');
      this.publicKeyPem = process.env.PLATFORM_PUBLIC_KEY.replace(/\\n/g, '\n');
      if (process.env.PLATFORM_KEY_ID) {
        this.keyId = process.env.PLATFORM_KEY_ID;
      }
      return { privateKey: this.privateKeyPem, publicKey: this.publicKeyPem, kid: this.keyId };
    }

    // Generate in-memory RSA keypair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    this.privateKeyPem = privateKey;
    this.publicKeyPem = publicKey;
    return { privateKey, publicKey, kid: this.keyId };
  }

  public static getPublicKeyPem(): string {
    return this.ensureKeyPair().publicKey;
  }

  public static getPrivateKeyPem(): string {
    return this.ensureKeyPair().privateKey;
  }

  public static getKeyId(): string {
    return this.keyId;
  }

  /**
   * Exports the public key formatted as an RFC 7517 JWKS document for /.well-known/jwks.json.
   */
  public static getJwksDocument(): JwksDocument {
    const { publicKey, kid } = this.ensureKeyPair();
    const keyObject = crypto.createPublicKey(publicKey);
    const jwk = keyObject.export({ format: 'jwk' }) as { kty: string; n?: string; e?: string };

    return {
      keys: [
        {
          kty: jwk.kty || 'RSA',
          kid,
          use: 'sig',
          alg: 'RS256',
          n: jwk.n || '',
          e: jwk.e || '',
        },
      ],
    };
  }

  /**
   * Resets keys for testing isolation.
   */
  public static resetKeys(): void {
    this.privateKeyPem = null;
    this.publicKeyPem = null;
  }
}
