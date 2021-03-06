const expect = require('expect.js');
const sinon = require('sinon');

const EventEmitter = require('events');
const Backend = require('../lib/aws-cloudwatch-statsd-backend').CloudwatchBackend;

describe('Backend', function () {

  const sandbox = sinon.sandbox.create();

  afterEach(function () {
    sandbox.restore();
  });

  describe('#flush()', function () {

    let emitter;

    beforeEach(function () {
      emitter = new EventEmitter();
    });

    it('should do nothing when no metrics found', function () {
      let instance = new Backend(1, {}, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      mockCloudwatch.expects('putMetricData').never();

      instance.flush('1500000000', {});
      mockCloudwatch.verify();
    });

    it('should do nothing when statsd metrics', function () {
      let instance = new Backend(1, {}, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      mockCloudwatch.expects('putMetricData').never();

      instance.flush('1500000000', {
        'counters': {
          'statsd.packets_received': 1,
        },
      });
      mockCloudwatch.verify();
    });

    it('should send counter metrics', function () {
      let instance = new Backend(1, {}, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      const expectedName = sinon.match.has('MetricName', 'test.metric1');
      mockCloudwatch.expects('putMetricData').once().withArgs(sinon.match.has('MetricData', sinon.match.has('0', expectedName)));

      instance.flush('1500000000', {
        'counters': {
          'test.metric1': 5,
        },
      });
      mockCloudwatch.verify();
    });

    it('should send counter metrics when alias not match', function () {
      let instance = new Backend(1, {
        'alias': {
          'test.metric2': 'CloudMetric',
        },
      }, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      const expectedName = sinon.match.has('MetricName', 'test.metric1');
      mockCloudwatch.expects('putMetricData').once().withArgs(sinon.match.has('MetricData', sinon.match.has('0', expectedName)));

      instance.flush('1500000000', {
        'counters': {
          'test.metric1': 5,
        },
      });
      mockCloudwatch.verify();
    });

    it('should send alias metrics when match', function () {
      let instance = new Backend(1, {
        'alias': {
          'test.metric1': 'CloudMetric',
        },
      }, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      const expectedName = sinon.match.has('MetricName', 'CloudMetric');
      mockCloudwatch.expects('putMetricData').once().withArgs(sinon.match.has('MetricData', sinon.match.has('0', expectedName)));

      instance.flush('1500000000', {
        'counters': {
          'test.metric1': 5,
        },
      });
      mockCloudwatch.verify();
    });

    it('should send alias metrics when suffix match', function () {
      let instance = new Backend(1, {
        'alias': {
          'test.metric1': 'CloudMetric',
        },
      }, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      const expectedName = sinon.match.has('MetricName', 'CloudMetric');
      mockCloudwatch.expects('putMetricData').once().withArgs(sinon.match.has('MetricData', sinon.match.has('0', expectedName)));

      instance.flush('1500000000', {
        'counters': {
          'hostname1.test.metric1': 5,
        },
      });
      mockCloudwatch.verify();
    });

    it('should set counter dimensions', function () {
      let instance = new Backend(1, {
        'dimensions': {
          'Dimension': 'unknown',
          'Another': 'one',
        },
        'alias': {
          'test.metric1': 'CloudMetric',
        },
      }, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      const expectedDimension = sinon.match.has('Dimensions', [{
        'Name': 'Dimension',
        'Value': 'unknown',
      }, {
        'Name': 'Another',
        'Value': 'one',
      }]);
      const expectedName = sinon.match.has('MetricName', 'CloudMetric');
      const expectedDatum = expectedName.and(expectedDimension);
      mockCloudwatch.expects('putMetricData').once().withArgs(sinon.match.has('MetricData', sinon.match.has('0', expectedDatum)));

      instance.flush('1500000000', {
        'counters': {
          'hostname1.test.metric1': 5,
        },
      });
      mockCloudwatch.verify();
    });

    it('should set timer dimensions', function () {
      let instance = new Backend(1, {
        'dimensions': {
          'Dimension': 'unknown',
        },
        'alias': {
          'test.metric1': 'CloudMetric',
        },
      }, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      const expectedDimension = sinon.match.has('Dimensions', [{
        'Name': 'Dimension',
        'Value': 'unknown',
      }]);
      const expectedName = sinon.match.has('MetricName', 'CloudMetric');
      const expectedDatum = expectedName.and(expectedDimension);
      mockCloudwatch.expects('putMetricData').once().withArgs(sinon.match.has('MetricData', sinon.match.has('0', expectedDatum)));

      instance.flush('1500000000', {
        'timers': {
          'hostname1.test.metric1': [5, 2, 5, 4, 3],
        },
      });
      mockCloudwatch.verify();
    });

    it('should set gauge dimensions', function () {
      let instance = new Backend(1, {
        'dimensions': {
          'Dimension': 'unknown',
        },
        'alias': {
          'test.metric1': 'CloudMetric',
        },
      }, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      const expectedDimension = sinon.match.has('Dimensions', [{
        'Name': 'Dimension',
        'Value': 'unknown',
      }]);
      const expectedName = sinon.match.has('MetricName', 'CloudMetric');
      const expectedDatum = expectedName.and(expectedDimension);
      mockCloudwatch.expects('putMetricData').once().withArgs(sinon.match.has('MetricData', sinon.match.has('0', expectedDatum)));

      instance.flush('1500000000', {
        'gauges': {
          'hostname1.test.metric1': 5,
        },
      });
      mockCloudwatch.verify();
    });

    it('should set SET dimensions', function () {
      let instance = new Backend(1, {
        'dimensions': {
          'Dimension': 'unknown',
        },
        'alias': {
          'test.metric1': 'CloudMetric',
        },
      }, emitter);
      let mockCloudwatch = sandbox.mock(instance.cloudwatch);

      const expectedDimension = sinon.match.has('Dimensions', [{
        'Name': 'Dimension',
        'Value': 'unknown',
      }]);
      const expectedName = sinon.match.has('MetricName', 'CloudMetric');
      const expectedDatum = expectedName.and(expectedDimension);
      mockCloudwatch.expects('putMetricData').once().withArgs(sinon.match.has('MetricData', sinon.match.has('0', expectedDatum)));

      instance.flush('1500000000', {
        'sets': {
          'hostname1.test.metric1': new Set(),
        },
      });
      mockCloudwatch.verify();
    });
  });
});
