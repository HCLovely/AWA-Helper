/* eslint-disable max-len */
/* global __, steamGameInfo, proxy, myAxiosConfig */
import * as fs from 'fs';
import { load } from 'cheerio';
import * as chalk from 'chalk';
import { Logger, netError, sleep, time, http as axios, formatProxy, Cookie } from './tool';
import * as SteamUser from 'steam-user';
import * as events from 'events';
const EventEmitter = new events.EventEmitter();

class SteamQuestSU {
  awaCookie: Cookie;
  awaHttpsAgent!: myAxiosConfig['httpsAgent'];
  ownedGames: Array<string> = [];
  ownedAllGames: Array<string> = [];
  maxPlayTimes = 2;
  gamesInfo: Array<steamGameInfo> = [];
  maxArp = 0;
  status = 'none';
  taskStatus!: Array<steamGameInfo>;
  // @ts-ignore
  suClint = new SteamUser({ renewRefreshTokens: true });
  suInfo: {
    accountName: string
    password?: string
    refreshToken?: string
  };
  EventEmitter = EventEmitter;

  constructor({ awaCookie, steamAccountName, steamPassword, proxy }: { awaCookie: string, steamAccountName: string, steamPassword: string, proxy?: proxy }) {
    this.awaCookie = new Cookie(awaCookie);
    this.suInfo = {
      accountName: steamAccountName
    };
    const refreshToken = fs.existsSync('refresh_token.txt') ? fs.readFileSync('refresh_token.txt').toString() : null;
    if (refreshToken) {
      this.suInfo.refreshToken = refreshToken;
    } else {
      new Logger(chalk.red(__('firstSteamUserAlert', chalk.yellow('SU'), chalk.blue(__('2fa')))));
      this.suInfo.password = steamPassword;
    }
    if (proxy?.enable?.includes('steam') && proxy.host && proxy.port) {
      this.suClint.setOption('httpProxy', `${proxy.protocol || 'http'}://${proxy.username && proxy.password ? `${proxy.username}:${proxy.password}@` : ''}${proxy.host}:${proxy.port}`);
    }
    if (proxy?.enable?.includes('awa') && proxy.host && proxy.port) {
      this.awaHttpsAgent = formatProxy(proxy);
    }
  }

  init(): Promise<boolean> {
    return new Promise((resolve) => {
      const logger = new Logger(`${time()}${__('loginingSteam', chalk.yellow('Steam'))}`, false);

      // @ts-ignore
      this.suClint.on('refreshToken', (token) => {
        fs.writeFileSync('refresh_token.txt', token);
      });
      this.suClint.on('loggedOn', () => {
        logger.log(chalk.green(`${__('loginSuccess')}[${chalk.gray(this.suClint.steamID?.getSteamID64())}]`));
        resolve(true);
      });

      this.suClint.logOn(this.suInfo);
    });
  }
  async getSteamQuests(): Promise<boolean> {
    const logger = new Logger(`${time()}${__('gettingSteamQuestInfo', chalk.yellow('Steam'))}`, false);
    const options: myAxiosConfig = {
      url: `https://${globalThis.awaHost}/steam/quests`,
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'user-agent': globalThis.userAgent
      },
      Logger: logger
    };
    if (this.awaHttpsAgent) options.httpsAgent = this.awaHttpsAgent;
    return axios(options)
      .then(async (response) => {
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(response.headers['set-cookie']))])];
        if (response.status === 200) {
          const $ = load(response.data);
          const gamesInfo = [];
          for (const row of $('div.container>div.row').toArray()) {
            const $row = $(row);
            /*
            const id = $row.find('img[src*="cdn.cloudflare.steamstatic.com/steam/apps/"]').eq(0)
              .attr('src')
              ?.match(/steam\/apps\/([\d]+)/)?.[1];
            if (!id) continue;
            */
            const questLink = new URL($row.find('a.btn-steam-quest[href]').attr('href') as string, `https://${globalThis.awaHost}/`).href;
            const [id, started] = await this.getQuestInfo(questLink);

            if (!started || !id) continue;
            const playTime = $row.find('.media-body p').text()
              .trim()
              .match(/([\d]+)[\s]*hour/i)?.[1];
            const arp = $row.find('.text-steam-light').text()
              .trim()
              .match(/([\d]+)[\s]*ARP/i)?.[1];
            gamesInfo.push({
              id: id as string,
              time: playTime ? parseInt(playTime, 10) : 0,
              arp: arp ? parseInt(arp, 10) : 0,
              link: questLink
            });
          }
          this.gamesInfo = gamesInfo;
          ((response.config as myAxiosConfig)?.Logger || logger).log(`${time()}${chalk.green(__('getSteamQuestInfoSuccess', chalk.yellow('Steam')))}`);
          return true;
        }
        ((response.config as myAxiosConfig)?.Logger || logger).log(`${time()}${chalk.red(`${__('getSteamQuestInfoFailed', chalk.yellow('Steam'))}[Net Error]: ${response.status}`)}`);
        return false;
      })
      .catch((error) => {
        ((error.config as myAxiosConfig)?.Logger || logger).log(time() + chalk.red(__('getSteamQuestInfoFailed', chalk.yellow('Steam'))) + netError(error));
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(error.response?.headers?.['set-cookie']))])];
        new Logger(error);
        return false;
      });
  }
  async awaCheckOwnedGames(name: string): Promise<boolean> {
    const logger = new Logger(`${time()}${__('recheckingOwnedGames', chalk.yellow(name))}`, false);
    const taskUrl = `https://${globalThis.awaHost}/steam/quests/${name}`;
    if (name === 'choose-your-own-game') {
      logger.log(chalk.green(__('owned')));
      return (await this.getQuestInfo(taskUrl, true))[1] as boolean;
    }
    const options: myAxiosConfig = {
      url: `https://${globalThis.awaHost}/ajax/user/steam/quests/check-owned-games/${name}`,
      method: 'GET',
      headers: {
        cookie: this.awaCookie.stringify(),
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'user-agent': globalThis.userAgent,
        referer: taskUrl
      },
      Logger: logger
    };
    if (this.awaHttpsAgent) options.httpsAgent = this.awaHttpsAgent;
    return axios(options)
      .then(async (response) => {
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(response.headers['set-cookie']))])];
        if (response.status === 200) {
          if (response.data?.installed === true) {
            ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.green(__('owned')));
            return (await this.getQuestInfo(taskUrl, true))[1] as boolean;
          }
          ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.yellow(__('notOwned')));
          return false;
        }
        ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.red(`Error(1): ${response.status}`));
        return false;
      })
      .catch((error) => {
        ((error.config as myAxiosConfig)?.Logger || logger).log(chalk.red('Error(0)') + netError(error));
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(error.response?.headers?.['set-cookie']))])];
        new Logger(error);
        return false;
      });
  }
  async getQuestInfo(url: string, isRetry = false): Promise<Array<string | boolean>> {
    const name = url.match(/steam\/quests\/(.+)/)?.[1];
    const logger = new Logger(`${time()}${__('gettingSingleSteamQuestInfo', chalk.yellow(name || url))}`, false);
    const options: myAxiosConfig = {
      url,
      method: 'GET',
      responseType: 'text',
      headers: {
        cookie: this.awaCookie.stringify(),
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'user-agent': globalThis.userAgent,
        referer: `https://${globalThis.awaHost}/steam/quests`
      },
      Logger: logger
    };
    if (this.awaHttpsAgent) options.httpsAgent = this.awaHttpsAgent;

    return axios(options)
      .then(async (response) => {
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(response.headers['set-cookie']))])];
        const $ = load(response.data);
        const id = $('img[src*="cdn.cloudflare.steamstatic.com/steam/apps/"]').eq(0)
          .attr('src')
          ?.match(/steam\/apps\/([\d]+)/)?.[1] ||
          response.data.match(/cdn\.cloudflare\.steamstatic\.com\/steam\/apps\/([\d]+)/)?.[1] || '';
        if (response.data.includes('You have completed this quest')) {
          ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.green(__('steamQuestCompleted')));
          return [id, false];
        }
        if (response.data.includes('This quest requires that you own')) {
          if (name && !isRetry) {
            ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.yellow(__('steamQuestRecheck')));
            return [id, await this.awaCheckOwnedGames(name)];
          }
          ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.yellow(__('steamQuestSkipped')));
          return [id, false];
        }
        if (response.data.includes('Launch Game')) {
          ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.green(__('steamQuestStarted')));
          return [id, true];
        }
        if (response.data.includes('Sync Games')) {
          ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.yellow(__('steamQuestNotChoose')));
          if (isRetry) {
            return [id, false];
          }
          const steamGameId = $('#userGames>option').eq(0).attr('value');
          if (!steamGameId) {
            new Logger(`${time()}${chalk.red(__('noSteamGames'))}`, false);
            return [id, false];
          }
          await this.chooseOwnGame(url, steamGameId);
          return await this.getQuestInfo(url, true);
        }
        if (response.data.includes('Start Quest')) {
          ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.green('OK'));
          return [id, await this.startQuest(url)];
        }
        ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.red(`Error(1): ${response.status}`));
        return [id, false];
      })
      .catch((error) => {
        ((error.config as myAxiosConfig)?.Logger || logger).log(chalk.red('Error(0)') + netError(error));
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(error.response?.headers?.['set-cookie']))])];
        new Logger(error);
        return ['', false];
      });
  }
  async chooseOwnGame(url: string, steamGameId: string): Promise<boolean> {
    const logger = new Logger(`${time()}${__('choosingOwnGame', chalk.yellow(steamGameId))}`, false);
    const options: myAxiosConfig = {
      url: url.replace('steam/quests', 'ajax/user/steam/quests/start-select-own'),
      method: 'POST',
      responseType: 'text',
      headers: {
        cookie: this.awaCookie.stringify(),
        accept: '*/*',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'user-agent': globalThis.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        referer: url
      },
      data: steamGameId,
      Logger: logger
    };
    if (this.awaHttpsAgent) options.httpsAgent = this.awaHttpsAgent;

    return axios(options)
      .then(async (response) => {
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(response.headers?.['set-cookie']))])];
        if (response.status === 200) {
          ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.green('OK'));
          return true;
        }
        ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.red('Error(1)'));
        new Logger(response.data || response.statusText);
        return false;
      })
      .catch((error) => {
        ((error.config as myAxiosConfig)?.Logger || logger).log(chalk.red('Error(0)') + netError(error));
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(error.response?.headers?.['set-cookie']))])];
        new Logger(error);
        return false;
      });
  }
  async startQuest(url: string): Promise<boolean> {
    const logger = new Logger(`${time()}${__('startingSteamQuest', chalk.yellow(url))}`, false);
    const options: myAxiosConfig = {
      url: url.replace('steam/quests', 'ajax/user/steam/quests/start'),
      method: 'GET',
      headers: {
        cookie: this.awaCookie.stringify(),
        'user-agent': globalThis.userAgent,
        referer: url
      },
      Logger: logger
    };
    if (this.awaHttpsAgent) options.httpsAgent = this.awaHttpsAgent;
    return axios(options)
      .then((response) => {
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(response.headers['set-cookie']))])];
        if (response.data.success) {
          ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.green('OK'));
          return true;
        }
        ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.red(`Error(1): ${response.data.message || response.status}`));
        return false;
      })
      .catch((error) => {
        ((error.config as myAxiosConfig)?.Logger || logger).log(chalk.red('Error(0)') + netError(error));
        globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(error.response?.headers?.['set-cookie']))])];
        new Logger(error);
        return false;
      });
  }
  async checkStatus(): Promise<boolean> {
    if (this.status === 'stopped') return true;
    for (const index in this.taskStatus) {
      const logger = new Logger(`${time()}${__('checkingProgress', chalk.yellow(this.taskStatus[index].link))}`, false);
      const options: myAxiosConfig = {
        url: this.taskStatus[index].link,
        method: 'GET',
        responseType: 'text',
        headers: {
          cookie: this.awaCookie.stringify(),
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
          'user-agent': globalThis.userAgent,
          referer: `https://${globalThis.awaHost}/steam/quests`
        },
        Logger: logger
      };
      if (this.awaHttpsAgent) options.httpsAgent = this.awaHttpsAgent;
      await axios(options)
        .then((response) => {
          globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(response.headers['set-cookie']))])];
          if (response.data.includes('aria-valuenow')) {
            const progress = response.data.match(/aria-valuenow="([\d]+?)"/)?.[1];
            if (progress) {
              this.taskStatus[index].progress = progress;
              ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.yellow(`${progress}%`));
              return true;
            }
            ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.red(__('noProgress')));
            return false;
          }
          ((response.config as myAxiosConfig)?.Logger || logger).log(chalk.red(__('noProgressBar')));
          return false;
        })
        .catch((error) => {
          ((error.config as myAxiosConfig)?.Logger || logger).log(chalk.red('Error(0)') + netError(error));
          globalThis.secrets = [...new Set([...globalThis.secrets, ...Object.values(Cookie.ToJson(error.response?.headers?.['set-cookie']))])];
          new Logger(error);
          return false;
        });
    }
    if (this.taskStatus.filter((e) => parseInt(e.progress || '0', 10) >= 100).length === this.taskStatus.length && !globalThis.steamEventGameId) {
      this.EventEmitter.emit('complete');
      new Logger(time() + chalk.yellow('Steam') + chalk.green(__('steamQuestFinished')));
      this.resume();
      return true;
    }
    await sleep(60 * 10);
    return await this.checkStatus();
  }
  async getOwnedGames(): Promise<boolean> {
    if (!await this.getSteamQuests()) return false;
    if (this.gamesInfo.length === 0) return true;
    const logger = new Logger(`${time()}${__('matchingGames', chalk.yellow('Steam'))}`, false);

    const appids = this.gamesInfo.map((e) => parseInt(e.id, 10));
    if (globalThis.steamEventGameId) {
      appids.push(parseInt(globalThis.steamEventGameId, 10));
    }
    return this.suClint.getUserOwnedApps(this.suClint.steamID?.getSteamID64() as string, {
      includePlayedFreeGames: true,
      filterAppids: appids,
      includeFreeSub: true
    })
      .then((response) => {
        // @ts-ignore
        this.ownedAllGames = response.apps.map((e) => `${e.appid}`);
        this.ownedGames = this.ownedAllGames.filter((id) => id !== globalThis.steamEventGameId);
        if (this.ownedGames.length > 0) {
          this.maxArp = this.ownedGames.map((id) => this.gamesInfo.find((info) => info.id === id)?.arp || 0).reduce((acr, cur) => acr + cur);
          this.maxPlayTimes = Math.max(...this.ownedGames.map((id) => this.gamesInfo.find((info) => info.id === id)?.time || 2));
          this.taskStatus = this.ownedGames.map((id) => this.gamesInfo.find((info) => info.id === id)).filter((e) => e) as Array<steamGameInfo>;
        }
        logger.log(chalk.green('OK'));
        return true;
      })
      .catch((error) => {
        logger.log(chalk.red('Error(0)'));
        new Logger(error);
        return false;
      });
  }
  async playGames(): Promise<boolean> {
    if (!await this.getOwnedGames()) return false;
    if (this.ownedAllGames.length === 0) {
      new Logger(time() + chalk.yellow(__('noGamesAlert')));
      this.suClint.logOff();
      this.status = 'stopped';
      return false;
    }
    const logger = new Logger(`${time()}${__('playingGames')}`, false);

    this.suClint.gamesPlayed(this.ownedAllGames.map((e) => parseInt(e, 10)), true);
    logger.log(chalk.green('OK'));
    await sleep(10 * 60);
    return await this.checkStatus();
  }
  resume(): boolean {
    if (this.status === 'stopped') return true;
    const logger = new Logger(`${time()}${__('stoppingPlayingGames')}`, false);
    this.suClint.gamesPlayed([]);
    this.suClint.logOff();
    logger.log(chalk.green('OK'));
    return true;
  }
}

export { SteamQuestSU };
