import {
  Component,
  ElementRef,
  effect,
  input,
  viewChild,
  OnDestroy,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-usage-chart',
  template: '<canvas #canvas></canvas>',
  styles: [
    ':host { display:block; position:relative; height:300px; width:100%; }',
  ],
})
export class UsageChart implements OnDestroy {
  readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  readonly labels = input<string[]>([]);
  readonly data = input<number[]>([]);
  readonly unit = input<string>('');
  readonly color = input<string>('#4f8cff');
  readonly kind = input<'bar' | 'line'>('bar');

  private chart?: Chart;

  constructor() {
    effect(() => {
      const labels = this.labels();
      const data = this.data();
      const unit = this.unit();
      const color = this.color();
      const kind = this.kind();
      this.render(labels, data, unit, color, kind);
    });
  }

  private render(
    labels: string[],
    data: number[],
    unit: string,
    color: string,
    kind: 'bar' | 'line',
  ): void {
    const canvas = this.canvasRef().nativeElement;
    const grid = 'rgba(255,255,255,0.08)';
    const tick = '#9aa7bd';

    const config: ChartConfiguration = {
      type: kind,
      data: {
        labels,
        datasets: [
          {
            label: `Usage (${unit})`,
            data,
            backgroundColor: kind === 'bar' ? color : 'transparent',
            borderColor: color,
            borderWidth: 2,
            tension: 0.25,
            pointRadius: kind === 'line' ? 3 : 0,
            pointBackgroundColor: color,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.formattedValue} ${unit}`,
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

    if (this.chart) {
      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = data;
      this.chart.data.datasets[0].label = `Usage (${unit})`;
      this.chart.update();
    } else {
      this.chart = new Chart(canvas, config);
    }
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }
}
