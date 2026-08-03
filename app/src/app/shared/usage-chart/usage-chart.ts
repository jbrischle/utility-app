import { Component, effect, ElementRef, input, OnDestroy, viewChild } from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

export interface ChartSeries {
  label: string;
  data: number[];
  color: string;
}

@Component({
  selector: 'app-usage-chart',
  template: '<canvas #canvas></canvas>',
  styles: [':host { display:block; position:relative; height:300px; width:100%; }'],
})
export class UsageChart implements OnDestroy {
  readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  readonly labels = input<string[]>([]);
  readonly series = input<ChartSeries[]>([]);
  readonly unit = input<string>('');
  readonly kind = input<'bar' | 'line'>('bar');

  private chart?: Chart;

  constructor() {
    effect(() => {
      const labels = this.labels();
      const series = this.series();
      const unit = this.unit();
      const kind = this.kind();
      this.render(labels, series, unit, kind);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private render(
    labels: string[],
    series: ChartSeries[],
    unit: string,
    kind: 'bar' | 'line',
  ): void {
    const canvas = this.canvasRef().nativeElement;
    const grid = 'rgba(255,255,255,0.08)';
    const tick = '#9aa7bd';

    const datasets = series.map((s) => ({
      label: s.label,
      data: s.data,
      backgroundColor: kind === 'bar' ? s.color : 'transparent',
      borderColor: s.color,
      borderWidth: 2,
      tension: 0.25,
      pointRadius: kind === 'line' ? 3 : 0,
      pointBackgroundColor: s.color,
      borderRadius: 4,
    }));

    const config: ChartConfiguration = {
      type: kind,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: series.length > 1,
            labels: { color: tick },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.formattedValue} ${unit}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: grid },
            ticks: { color: tick, maxRotation: 0, autoSkip: true },
          },
          y: {
            beginAtZero: true,
            grid: { color: grid },
            ticks: { color: tick },
            title: { display: true, text: unit, color: tick },
          },
        },
      },
    };

    this.chart?.destroy();
    this.chart = new Chart(canvas, config);
  }
}
