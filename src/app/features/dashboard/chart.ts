import { Component, computed, input } from '@angular/core';
import { reais } from '../estoque/format';
import { dateLabel, instantLabel } from './presentation';
@Component({
  selector: 'mnr-dashboard-chart',
  template: `
    <h3>{{ title() }}</h3>
    <p>{{ description() }}</p>
    <figure>
      <svg
        viewBox="0 0 600 240"
        role="img"
        [attr.aria-label]="
          title() +
          '. Eixo vertical: reais. Eixo horizontal: competência. Dados completos na tabela abaixo.'
        "
      >
        @for (tick of chart().ticks; track tick.y) {
          <line x1="112" x2="580" [attr.y1]="tick.y" [attr.y2]="tick.y" class="grid" />
          <text x="104" [attr.y]="tick.y + 4" text-anchor="end">{{ money(tick.value) }}</text>
        }
        <line x1="112" x2="580" [attr.y1]="chart().zero" [attr.y2]="chart().zero" class="zero" />
        <polyline [attr.points]="chart().line" />
        @if (points().length === 1) {
          <circle cx="346" [attr.cy]="chart().zeroValue" r="4" />
        }
        <text x="112" y="224">{{ date(points()[0]?.label ?? '') }}</text>
        <text x="580" y="224" text-anchor="end">
          {{ date(points()[points().length - 1]?.label ?? '') }}
        </text>
      </svg>
      <figcaption>
        Reais (R$) por {{ grouping() === 'DIARIO' ? 'dia' : 'mês' }} ·
        {{
          chart().allZero
            ? 'Sem movimento: todos os pontos são zero.'
            : 'Valores negativos representam reversões líquidas.'
        }}
      </figcaption>
    </figure>
    <details>
      <summary>Ver dados de {{ title().toLowerCase() }} em tabela</summary>
      <div
        class="table-scroll"
        tabindex="0"
        role="region"
        [attr.aria-label]="'Tabela de ' + title()"
      >
        <table>
          <caption>
            {{
              title()
            }}
            · valores líquidos oficiais
          </caption>
          <thead>
            <tr>
              <th scope="col">Competência</th>
              <th scope="col">Valor (R$)</th>
            </tr>
          </thead>
          <tbody>
            @for (p of points(); track p.label) {
              <tr>
                <th scope="row">{{ date(p.label) }}</th>
                <td>{{ money(p.value) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </details>
    <small>Consulta: {{ instant(consultedAt()) }}</small>
  `,
  styleUrl: './chart.scss',
})
export class DashboardChart {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly points = input.required<{ label: string; value: number }[]>();
  readonly grouping = input.required<string>();
  readonly consultedAt = input.required<string>();
  readonly money = reais;
  readonly date = dateLabel;
  readonly instant = instantLabel;
  // Geometry only. No aggregation, KPI calculation or rounding of the source DTOs.
  readonly chart = computed(() => {
    const points = this.points(),
      values = points.map((p) => p.value);
    const min = Math.min(0, ...values),
      max = Math.max(0, ...values);
    const span = max - min || 1;
    const y = (n: number) => 190 - ((n - min) / span) * 170;
    return {
      ticks: [...new Set([max, 0, min])].map((value) => ({ value, y: y(value) })),
      zero: y(0),
      zeroValue: y(values[0] ?? 0),
      line: points
        .map(
          (p, i) =>
            `${points.length === 1 ? 346 : 112 + (i * 468) / (points.length - 1)},${y(p.value)}`,
        )
        .join(' '),
      allZero: values.every((v) => v === 0),
    };
  });
}
