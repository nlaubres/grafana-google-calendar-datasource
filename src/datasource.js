import _ from 'lodash';
import moment from 'moment';
import scriptjs from './libs/script.js';

export class GoogleCalendarDatasource {

  constructor(instanceSettings, $q, templateSrv, timeSrv, backendSrv) {
    this.type = instanceSettings.type;
    this.name = instanceSettings.name;
    this.id = instanceSettings.id;
    this.access = instanceSettings.jsonData.access || 'direct';
    this.clientId = instanceSettings.jsonData.clientId;
    this.scopes = 'https://www.googleapis.com/auth/calendar.readonly';
    this.discoveryDocs = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
    this.q = $q;
    this.templateSrv = templateSrv;
    this.timeSrv = timeSrv;
    this.backendSrv = backendSrv;
    this.initialized = false;
  }

  load() {
    let deferred = this.q.defer();
    scriptjs('https://apis.google.com/js/api.js', () => {
      gapi.load('client:auth2', () => {
        return deferred.resolve();
      });
    });
    return deferred.promise;
  }

  testDatasource() {
    return this.initialize().then(() => {
      return { status: 'success', message: 'Data source is working', title: 'Success' };
    }).catch(err => {
      console.log(err);
      return { status: "error", message: err.message, title: "Error" };
    });
  }

  initialize() {
    if (this.access == 'proxy') {
      return Promise.resolve([]);
    }
    if (this.initialized) {
      return Promise.resolve(gapi.auth2.getAuthInstance().currentUser.get());
    }

    return this.load().then(() => {
      return gapi.client.init({
        clientId: this.clientId,
        scope: this.scopes,
        discoveryDocs: this.discoveryDocs
      }).then(() => {
        let authInstance = gapi.auth2.getAuthInstance();
        if (!authInstance) {
          throw { message: 'failed to initialize' };
        }
        let isSignedIn = authInstance.isSignedIn.get();
        if (isSignedIn) {
          this.initialized = true;
          return authInstance.currentUser.get();
        }
        return authInstance.signIn().then(user => {
          this.initialized = true;
          return user;
        });
      }, err => {
        console.log(err);
        throw { message: 'failed to initialize' };
      });
    });
  }

  metricFindQuery(query) {
    return this.initialize().then(() => {
      let timeRange = this.timeSrv.timeRange();
      let eventsQuery = query.match(/^events\((([^,]+), *)?([^,]+), *([^,]+)\)/);
      if (eventsQuery) {
        let calendarId = eventsQuery[2];
        let fieldPath = eventsQuery[3];
        let filter = eventsQuery[4];
        let params = {
          'calendarId': calendarId,
          'timeMin': timeRange.from.toISOString(),
          'timeMax': timeRange.to.toISOString(),
          'orderBy': 'startTime',
          'showDeleted': false,
          'singleEvents': true,
          'maxResults': 250,
        };
        if (filter.indexOf('=') >= 0) {
          params.sharedExtendedProperty = filter;
        } else {
          params.q = filter;
        }
        return this.getEvents(params).then(events => {
          return this.q.when(events.map(event => {
            return { text: _.get(event, fieldPath) };
          }));
        });
      }

      let fromToQuery = query.match(/^(from|to)\((([^,]+), *)?([^,]+), *([^,]+), *([^,]+)\)/);
      if (fromToQuery) {
        let key = fromToQuery[1] === 'from' ? 'start' : 'end';
        let calendarId = fromToQuery[3];
        let format = fromToQuery[4];
        let offset = parseInt(fromToQuery[5], 10);
        let filter = fromToQuery[6];
        let params = {
          'calendarId': calendarId,
          'timeMin': timeRange.from.toISOString(),
          'timeMax': timeRange.to.toISOString(),
          'orderBy': 'startTime',
          'showDeleted': false,
          'singleEvents': true,
          'maxResults': 250,
        };
        if (filter.indexOf('=') >= 0) {
          params.sharedExtendedProperty = filter;
        } else {
          params.q = filter;
        }
        return this.getEvents(params).then(events => {
          events.sort((a, b) => {
            return (a[key].dateTime || a[key].date) > (b[key].dateTime || b[key].date);
          });
          let lastIndex = events.findIndex(event => {
            return moment(event.start.dateTime || event.start.date) < moment();
          });
          if (lastIndex === -1) {
            return {};
          }
          let index = lastIndex + offset;
          if (index < 0 || index >= events.length) {
            return {};
          }
          let date = moment(events[index][key].dateTime || events[index][key].date);
          if (format === 'offset' || format === '-offset') {
            date = Math.floor(moment.duration(timeRange.to.diff(date)).asSeconds());
            if (format === 'offset') {
              date = -date;
            }
            date = date + 's';
          } else {
            date = date.format(format);
          }
          return [{ text: date }];
        });
      }

      let rangeQuery = query.match(/^range\((([^,]+), *)?([^,]+), *([^,]+), *([^,]+)\)/);
      if (rangeQuery) {
        let calendarId = rangeQuery[2];
        let format = rangeQuery[3];
        let offset = parseInt(rangeQuery[4], 10);
        let filter = rangeQuery[5];
        let params = {
          'calendarId': calendarId,
          'timeMin': timeRange.from.toISOString(),
          'timeMax': timeRange.to.toISOString(),
          'orderBy': 'startTime',
          'showDeleted': false,
          'singleEvents': true,
          'maxResults': 250,
        };
        if (filter.indexOf('=') >= 0) {
          params.sharedExtendedProperty = filter;
        } else {
          params.q = filter;
        }
        return this.getEvents(params).then(events => {
          events.sort((a, b) => {
            return (a[key].dateTime || a[key].date) > (b[key].dateTime || b[key].date);
          });
          let lastIndex = events.findIndex(event => {
            return moment(event.start.dateTime || event.start.date) < moment();
          });
          if (lastIndex === -1) {
            return {};
          }
          let index = lastIndex + offset;
          if (index < 0 || index >= events.length) {
            return {};
          }
          let end = moment(events[index].end.dateTime || events[index].end.date);
          let start = moment(events[index].start.dateTime || events[index].start.date);
          let range = '';
          if (format === 'offset' || format === '-offset') {
            range = Math.floor(moment.duration(end.diff(start)).asSeconds());
            if (format === 'offset') {
              range = -range;
            }
            range = range + 's';
          }
          return [{ text: range }];
        });
      }

      return Promise.reject(new Error('Invalid query'));
    });
  }

  annotationQuery(options) {
    var annotation = options.annotation;
    var calendarId = annotation.calendarId;

    if (_.isEmpty(calendarId)) {
      return this.q.when([]);
    }

    return this.initialize().then(() => {
      return (() => {
        let params = {
          'calendarId': calendarId,
          'timeMin': options.range.from.toISOString(),
          'timeMax': options.range.to.toISOString(),
          'orderBy': 'startTime',
          'showDeleted': false,
          'singleEvents': true,
          'maxResults': 250
        };
        return this.getEvents(params);
      })().then((events) => {
        var result = _.chain(events)
          .map((event) => {
            var start = moment(event.start.dateTime || event.start.date);
            var end = moment(event.end.dateTime || event.end.date);

            return [
              {
                regionId: event.id,
                annotation: annotation,
                time: start.valueOf(),
                title: event.summary,
                tags: ['Google Calender', event.organizer.displayName],
                text: event.description ? event.description : "",
              },
              {
                regionId: event.id,
                annotation: annotation,
                time: end.valueOf(),
                title: event.summary,
                tags: ['Google Calendar', event.organizer.displayName],
                text: event.description ? event.description : "",
              }
            ];
          }).flatten().value();

        return result;
      });
    });
  }

  getEvents(params) {
    return (() => {
      if (this.access != 'proxy') {
        return gapi.client.calendar.events.list(params);
      } else {
        return this.backendSrv.datasourceRequest({
          url: '/api/tsdb/query',
          method: 'POST',
          data: {
            queries: [
              _.extend({
                queryType: 'raw',
                api: 'calendar.events.list',
                refId: '',
                datasourceId: this.id
              }, params)
            ]
          }
        });
      }
    })().then(response => {
      return this.access != 'proxy' ? response.result.items : response.data.results[''].meta.items;
    });
  }
}
