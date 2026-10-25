import { Injectable, Module } from '@nestjs/common';
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
