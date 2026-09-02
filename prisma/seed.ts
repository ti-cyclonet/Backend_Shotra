import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding SHOTRA database...');

  // ═══════ CATEGORÍAS DE SERVICIO — Sector DELIVERY ═══════
  // Empezamos solo con delivery; se escala después a demanda.
  const deliveryCategories = [
    {
      name: 'Delivery',
      slug: 'delivery',
      icon: 'truck',
      description: 'Servicios de entrega, domicilios y transporte de paquetes',
      children: [
        { name: 'Domicilios de comida', slug: 'food-delivery', icon: 'utensils', description: 'Entrega de alimentos y restaurantes' },
        { name: 'Paquetería express', slug: 'express-packages', icon: 'package', description: 'Envío rápido de paquetes pequeños dentro de la ciudad' },
        { name: 'Mensajería', slug: 'messenger', icon: 'mail', description: 'Entrega de documentos, sobres y correspondencia' },
        { name: 'Compras y mandados', slug: 'errands', icon: 'shopping-bag', description: 'Hacer compras por ti y entregártelas' },
        { name: 'Mudanzas pequeñas', slug: 'small-moves', icon: 'box', description: 'Transporte de objetos medianos y mudanzas de pocas piezas' },
        { name: 'Transporte de mascotas', slug: 'pet-transport', icon: 'paw', description: 'Traslado seguro de mascotas a veterinario, guardería, etc.' },
        { name: 'Entrega de mercado', slug: 'grocery-delivery', icon: 'shopping-cart', description: 'Entrega de mercado y supermercado a domicilio' },
        { name: 'Recogida y entrega de prendas', slug: 'laundry-delivery', icon: 'shirt', description: 'Recoger y entregar ropa de lavandería/tintorería' },
      ],
    },
  ];

  for (const parent of deliveryCategories) {
    const { children, ...parentData } = parent;

    // Crear o actualizar categoría padre
    const savedParent = await prisma.serviceCategory.upsert({
      where: { slug: parentData.slug },
      update: { ...parentData },
      create: { ...parentData },
    });
    console.log(`  ✅ Categoría padre: ${savedParent.name} (${savedParent.id})`);

    // Crear subcategorías
    for (const child of children) {
      const savedChild = await prisma.serviceCategory.upsert({
        where: { slug: child.slug },
        update: { ...child, parentId: savedParent.id },
        create: { ...child, parentId: savedParent.id },
      });
      console.log(`     └─ ${savedChild.name}`);
    }
  }

  // ═══════ REGLAS DE COMISIÓN ═══════
  // Modelo actual: tasa fija por plan (FREE 10%, PRO 5%), rango 0..∞,
  // sin minFee (0) y tope maxFee $50.000 por contrato.
  // Para escalar a rangos por monto, agregar más filas con min/maxAmount.
  const commissionRules = [
    { planKey: 'FREE', minAmount: 0, maxAmount: null, ratePercent: 10, minFee: 0, maxFee: 50000, priority: 0 },
    { planKey: 'PRO', minAmount: 0, maxAmount: null, ratePercent: 5, minFee: 0, maxFee: 50000, priority: 0 },
  ];

  for (const rule of commissionRules) {
    // Idempotente: buscar por planKey + rango base
    const existing = await prisma.commissionRule.findFirst({
      where: { planKey: rule.planKey, minAmount: rule.minAmount, maxAmount: rule.maxAmount },
    });
    if (!existing) {
      await prisma.commissionRule.create({ data: rule });
      console.log(`  ✅ Regla de comisión: ${rule.planKey} ${rule.ratePercent}% (maxFee ${rule.maxFee})`);
    } else {
      await prisma.commissionRule.update({
        where: { id: existing.id },
        data: { ratePercent: rule.ratePercent, minFee: rule.minFee, maxFee: rule.maxFee, active: true },
      });
      console.log(`  ⚠️ Regla de comisión ${rule.planKey} ya existe, actualizada`);
    }
  }

  console.log('\n✅ Seed completado');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
