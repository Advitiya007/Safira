import test from 'node:test';
import assert from 'node:assert/strict';
import {
    decryptContact,
    encryptContact,
    hashContact,
    isEncryptedContact,
    validateContactEncryptionKey,
} from '../src/services/contactEncryptionService.js';

const KEY = Buffer.alloc(32, 19).toString('base64');

test('contact encryption hides plaintext and decrypts with authenticated encryption', () => {
    const previousKey = process.env.CONTACT_ENCRYPTION_KEY;
    process.env.CONTACT_ENCRYPTION_KEY = KEY;

    try {
        const phone = '9876543210';
        const encrypted = encryptContact(phone);
        assert.ok(isEncryptedContact(encrypted));
        assert.notEqual(encrypted, phone);
        assert.equal(decryptContact(encrypted), phone);
        assert.notEqual(encryptContact(phone), encrypted);
    } finally {
        if (previousKey === undefined) delete process.env.CONTACT_ENCRYPTION_KEY;
        else process.env.CONTACT_ENCRYPTION_KEY = previousKey;
    }
});

test('contact lookup hashes are stable for encrypted and plaintext values', () => {
    const previousKey = process.env.CONTACT_ENCRYPTION_KEY;
    process.env.CONTACT_ENCRYPTION_KEY = KEY;

    try {
        const phone = '9876543210';
        assert.equal(hashContact(phone), hashContact(encryptContact(phone)));
        assert.notEqual(hashContact(phone), hashContact('9876543211'));
    } finally {
        if (previousKey === undefined) delete process.env.CONTACT_ENCRYPTION_KEY;
        else process.env.CONTACT_ENCRYPTION_KEY = previousKey;
    }
});

test('contact encryption requires a valid key and rejects tampered ciphertext', () => {
    const previousKey = process.env.CONTACT_ENCRYPTION_KEY;
    const previousJwtSecret = process.env.JWT_SECRET;
    try {
        delete process.env.CONTACT_ENCRYPTION_KEY;
        delete process.env.JWT_SECRET;
        assert.throws(() => validateContactEncryptionKey(), /CONTACT_ENCRYPTION_KEY or JWT_SECRET/);

        process.env.CONTACT_ENCRYPTION_KEY = KEY;
        const encrypted = encryptContact('9876543210');
        const tampered = `${encrypted.slice(0, -2)}AA`;
        assert.throws(() => decryptContact(tampered), /Unable to decrypt/);
    } finally {
        if (previousKey === undefined) delete process.env.CONTACT_ENCRYPTION_KEY;
        else process.env.CONTACT_ENCRYPTION_KEY = previousKey;
        if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousJwtSecret;
    }
});

test('contact encryption uses the existing JWT secret when no dedicated key is configured', () => {
    const previousKey = process.env.CONTACT_ENCRYPTION_KEY;
    const previousJwtSecret = process.env.JWT_SECRET;
    try {
        delete process.env.CONTACT_ENCRYPTION_KEY;
        process.env.JWT_SECRET = 'stable-test-jwt-secret';
        const encrypted = encryptContact('9876543210');
        assert.equal(decryptContact(encrypted), '9876543210');
    } finally {
        if (previousKey === undefined) delete process.env.CONTACT_ENCRYPTION_KEY;
        else process.env.CONTACT_ENCRYPTION_KEY = previousKey;
        if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousJwtSecret;
    }
});
