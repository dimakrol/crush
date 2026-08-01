import { Controller, Get, Header, Redirect } from '@nestjs/common';
import { env } from '@/config/env';
import { LOBBY_HTML } from './lobby.html';

@Controller()
export class LobbyController {
  @Get()
  @Redirect('/lobby', 302)
  root(): void {}

  @Get('lobby')
  @Header('Content-Type', 'text/html; charset=utf-8')
  lobby(): string {
    // The game name is the only server-injected value; the iframe URL comes
    // from the launch response so the lobby never hardcodes the game origin.
    return LOBBY_HTML.replace('{{GAME_ID}}', env.GAME_ID);
  }
}
