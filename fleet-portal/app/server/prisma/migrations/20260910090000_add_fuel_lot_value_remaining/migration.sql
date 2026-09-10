-- Отслеживаем, сколько от totalAmount партии ещё не списано FIFO-заправками.
-- Бэкофилл для существующих партий учитывает уже сделанные списания по
-- старой формуле (litersUsed*pricePerLiterAtUse), дальше списания будут
-- точными (см. computeFifoConsumption).
ALTER TABLE "FuelLot" ADD COLUMN "valueRemaining" REAL;

UPDATE "FuelLot"
SET "valueRemaining" = "totalAmount" - COALESCE(
  (SELECT SUM("litersUsed" * "pricePerLiterAtUse")
   FROM "FuelWithdrawalLotUsage"
   WHERE "FuelWithdrawalLotUsage"."lotId" = "FuelLot"."id"),
  0
);
