-- Chat por par de personas: cada usuario puede eliminar (ocultar) un chat
CREATE TABLE "chat_hides" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "otherProfileId" TEXT NOT NULL,
    "hiddenBefore" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_hides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_hides_profileId_otherProfileId_key" ON "chat_hides"("profileId", "otherProfileId");
