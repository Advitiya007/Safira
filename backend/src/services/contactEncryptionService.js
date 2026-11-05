import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const ENCRYPTED_PREFIX = 'enc:v1:';
const KEY_INFO_ENCRYPTION = 'safira-contact-encryption-v1';
const KEY_INFO_LOOKUP = 'safira-contact-lookup-v1';

const getMasterKey = () => {
    const configuredKey = process.env.CONTACT_ENCRYPTION_KEY;
    if (!configuredKey) {
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            throw new Error('Configure CONTACT_ENCRYPTION_KEY or JWT_SECRET before storing contact numbers');
        }
        return createHash('sha256')
            .update('safira-contact-key-fallback-v1:')
            .update(jwtSecret)
            .digest();
    }

    const key = Buffer.from(configuredKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== configuredKey) {
        throw new Error('CONTACT_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    return key;
};

const deriveKey = (info) => Buffer.from(
    hkdfSync('sha256', getMasterKey(), Buffer.alloc(0), info, 32),
);

export const validateContactEncryptionKey = () => {
    deriveKey(KEY_INFO_ENCRYPTION);
};

export const isEncryptedContact = (value) => (
    typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX)
);

export const encryptContact = (value) => {
    if (typeof value !== 'string' || value.length === 0) return value;
    if (isEncryptedContact(value)) return value;

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveKey(KEY_INFO_ENCRYPTION), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
};

export const decryptContact = (value) => {
    if (typeof value !== 'string' || !isEncryptedContact(value)) return value;

    const [ivValue, tagValue, ciphertextValue] = value.slice(ENCRYPTED_PREFIX.length).split(':');
    if (!ivValue || !tagValue || !ciphertextValue) {
        throw new Error('Stored contact number has an invalid encrypted format');
    }

    try {
        const decipher = createDecipheriv(
            'aes-256-gcm',
            deriveKey(KEY_INFO_ENCRYPTION),
            Buffer.from(ivValue, 'base64'),
        );
        decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
        return Buffer.concat([
            decipher.update(Buffer.from(ciphertextValue, 'base64')),
            decipher.final(),
        ]).toString('utf8');
    } catch (error) {
        throw new Error(`Unable to decrypt stored contact number: ${error.message}`);
    }
};

export const hashContact = (value) => {
    if (typeof value !== 'string' || value.length === 0) return value;
    const plaintext = decryptContact(value);
    return createHmac('sha256', deriveKey(KEY_INFO_LOOKUP))
        .update(plaintext)
        .digest('hex');
};
