import { Panel } from "@/components/ui";
import { SettingsPage } from "@/features/control-pages";

export function ConfigPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Configuración</h1>
        <p className="text-sm text-muted">Plan de la agencia, facturación y ajustes generales.</p>
      </div>
      <section id="plan" className="scroll-mt-4">
        <Panel title="Plan de la agencia">
          <p className="text-sm text-muted">No hay un plan guardado. Cuando la agencia tenga un plan contratado, el nombre y el estado aparecerán aquí.</p>
        </Panel>
      </section>
      <section id="facturacion" className="scroll-mt-4">
        <Panel title="Facturación">
          <p className="text-sm text-muted">No hay facturas ni un método de pago guardados.</p>
        </Panel>
      </section>
      <section id="ajustes" className="scroll-mt-4 space-y-3">
        <h2 className="font-display text-lg font-semibold">Ajustes generales</h2>
        <SettingsPage embedded />
      </section>
    </div>
  );
}
