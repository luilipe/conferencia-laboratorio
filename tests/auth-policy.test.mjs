import test from "node:test";
import assert from "node:assert/strict";
import {
  CORPORATE_EMAIL_SUFFIX,
  isCorporateEmail,
  normalizeEmail,
} from "../lib/auth-policy.ts";

test("aceita somente o domínio corporativo exato", () => {
  assert.equal(isCorporateEmail("pessoa@example.com"), true);
  assert.equal(isCorporateEmail(" PESSOA@EXAMPLE.COM "), true);
  assert.equal(isCorporateEmail("pessoa@gmail.com"), false);
  assert.equal(isCorporateEmail("pessoa@example.com.evil.test"), false);
  assert.equal(isCorporateEmail(CORPORATE_EMAIL_SUFFIX), false);
});

test("normaliza o e-mail antes do cadastro", () => {
  assert.equal(
    normalizeEmail(" Pessoa@example.com "),
    "pessoa@example.com",
  );
});
