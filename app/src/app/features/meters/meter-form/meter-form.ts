import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { form, FormField, maxLength, required, submit } from '@angular/forms/signals';
import { LocalStore } from '../../../data/local-store';
import {
  UTILITY_LABELS,
  UTILITY_TYPES,
  UTILITY_UNITS,
  UtilityType,
} from '../../../models/utility-type';
import { toSignal } from '@angular/core/rxjs-interop';

interface MeterFormModel {
  name: string;
  type: UtilityType;
  location: string;
  serialNumber: string;
  notes: string;
}

@Component({
  selector: 'app-meter-form',
  imports: [FormField, RouterLink],
  templateUrl: './meter-form.html',
  styleUrl: './meter-form.css',
})
export class MeterForm {
  readonly types = UTILITY_TYPES;
  readonly labels = UTILITY_LABELS;
  readonly units = UTILITY_UNITS;
  readonly notFound = signal(false);
  readonly model = signal<MeterFormModel>({
    name: '',
    type: 'electricity',
    location: '',
    serialNumber: '',
    notes: '',
  });
  readonly meterForm = form(this.model, (p) => {
    required(p.name, { message: 'A name is required.' });
    maxLength(p.name, 80, { message: 'Use at most 80 characters.' });
  });
  private readonly store = inject(LocalStore);
  private readonly route = inject(ActivatedRoute);
  private readonly routerParamMap = toSignal(this.route.paramMap);
  readonly id = computed(() => this.routerParamMap()?.get('id'));
  readonly isEdit = computed(() => !!this.id());
  private readonly router = inject(Router);
  private patched = false;

  constructor() {
    if (this.isEdit()) {
      effect(() => {
        const id = this.id();
        if (!id) {
          return;
        }

        if (this.patched || !this.store.ready()) return;
        const meter = this.store.getMeterById(id);
        if (!meter) {
          this.notFound.set(true);
          return;
        }
        this.model.set({
          name: meter.name,
          type: meter.type,
          location: meter.location,
          serialNumber: meter.serialNumber,
          notes: meter.notes,
        });
        this.patched = true;
      });
    }
  }

  unitPreview(): string {
    return this.units[this.model().type];
  }

  onSubmit(event: Event): void {
    const id = this.id();
    if (!id) {
      return;
    }

    event.preventDefault();
    submit(this.meterForm, async () => {
      const value = this.model();
      if (this.isEdit()) {
        await this.store.updateMeter(id, value);
        await this.router.navigate(['/meters', this.id]);
      } else {
        const meter = await this.store.addMeter(value);
        await this.router.navigate(['/meters', meter.id]);
      }
    });
  }
}
