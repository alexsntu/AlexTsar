-- Ключ идемпотентности для заправок: повторная отправка той же формы
-- (двойной клик, ретрай) не создаёт дубликат списания.
ALTER TABLE "FuelWithdrawal" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "FuelWithdrawal_idempotencyKey_key" ON "FuelWithdrawal"("idempotencyKey");
