var util = require('util');
var AWS = require('aws-sdk');
var proxy = require('proxy-agent');

function CloudwatchBackend(startupTime, config, emitter) {
  var self = this;

  // proxy check
  if (config.proxy) {
    config.httpOptions = { agent: proxy(config.proxy) };
    delete config.proxy;
  }


  this.config = config || {};
  AWS.config = this.config;

  function setEmitter() {
    self.cloudwatch = new AWS.CloudWatch(self.config);
    emitter.on('flush', function(timestamp, metrics) { self.flush(timestamp, metrics); });
  }

  // if iamRole is set attempt to fetch credentials from the Metadata Service
  if (this.config.iamRole) {
    if (this.config.iamRole == 'any') {
      // If the iamRole is set to any, then attempt to fetch any available credentials
      ms = new AWS.EC2MetadataCredentials();
      ms.refresh(function(err) {
        if (err) { console.log('Failed to fetch IAM role credentials: ' + err); }
        self.config.credentials = ms;
        setEmitter();
      });
    } else {
      // however if it's set to specify a role, query it specifically.
      ms = new AWS.MetadataService();
      ms.request('/latest/meta-data/iam/security-credentials/' + this.config.iamRole, function(err, rdata) {
        var data = JSON.parse(rdata);

        if (err) { console.log('Failed to fetch IAM role credentials: ' + err); }
        self.config.credentials = new AWS.Credentials(data.AccessKeyId, data.SecretAccessKey, data.Token);
        setEmitter();
      });
    }
  } else {
    setEmitter();
  }
};

CloudwatchBackend.prototype.processKey = function(key) {
  var parts = key.split(/[\.\/-]/);

  return {
    metricName: parts[parts.length - 1],
    namespace: parts.length > 1 ? parts.splice(0, parts.length - 1).join("/") : null
  };
};

CloudwatchBackend.prototype.getAlias = function getAlias(key) {
  if (this.config.alias) {
    for (var source in this.config.alias) {
      if (key.indexOf(source) >= 0) {
        return this.config.alias[source];
      }
    }
  }
  return key;
};

CloudwatchBackend.prototype.isBlacklisted = function(key) {
  var hasWhitelist = this.config.whitelist && this.config.whitelist.length > 0;
  var blacklisted = hasWhitelist;

  // First check if key is whitelisted
  if (hasWhitelist) {
    for (var i = 0; i < this.config.whitelist.length; i++) {
      if (key.indexOf(this.config.whitelist[i]) >= 0) {
        // console.log("Key (counter) " + key + " is whitelisted");
        return false;
      }
    }
  }

  if (this.config.blacklist && this.config.blacklist.length > 0) {
    for (var i = 0; i < this.config.blacklist.length; i++) {
      if (key.indexOf(this.config.blacklist[i]) >= 0) {
        blacklisted = true;
        break;
      }
    }
  }
  return blacklisted;
};

CloudwatchBackend.prototype.chunk = function(arr, chunkSize) {

  var groups = [],
    i;
  for (i = 0; i < arr.length; i += chunkSize) {
    groups.push(arr.slice(i, i + chunkSize));
  }
  return groups;
};

CloudwatchBackend.prototype.batchSend = function(currentMetricsBatch, namespace) {

  // send off the array (instead of one at a time)
  if (currentMetricsBatch.length > 0) {

    // Chunk into groups of 20
    var chunkedGroups = this.chunk(currentMetricsBatch, 20);

    for (var i = 0, len = chunkedGroups.length; i < len; i++) {
      this.cloudwatch.putMetricData({
        MetricData: chunkedGroups[i],
        Namespace: namespace
      }, function(err, data) {
        if (err) {
          // log an error
          console.log(util.inspect(err));
        } else {
          // Success
          console.log(util.inspect(data));
        }
      });
    }
  }
};

CloudwatchBackend.prototype.flush = function(timestamp, metrics) {

  console.log('Flushing metrics at ' + new Date(timestamp * 1000).toISOString());

  var counters = metrics.counters;
  var gauges = metrics.gauges;
  var timers = metrics.timers;
  var sets = metrics.sets;

  // put all currently accumulated counter metrics into an array
  var currentCounterMetrics = [];
  var dimensions = null;
  if (this.config.dimensions) {
    dimensions = [];
    for (var key in this.config.dimensions) {
      dimensions.push({
        Name: key,
        Value: this.config.dimensions[key],
      });
    }
  }
  var namespace = "AwsCloudWatchStatsdBackend";
  for (key in counters) {
    if (key.indexOf('statsd.') == 0)
      continue;

    if (this.isBlacklisted(key)) {
      continue;
    }

    var names = this.config.processKeyForNamespace ? this.processKey(key) : {};
    namespace = this.config.namespace || names.namespace || "AwsCloudWatchStatsdBackend";
    var metricName = this.config.metricName || names.metricName || key;

    var datum = {
      MetricName: this.getAlias(metricName),
      Unit: 'Count',
      Timestamp: new Date(timestamp * 1000).toISOString(),
      Value: counters[key]
    };
    if (dimensions) {
      datum.Dimensions = dimensions;
    }
    currentCounterMetrics.push(datum);
  }

  this.batchSend(currentCounterMetrics, namespace);

  // put all currently accumulated timer metrics into an array
  var currentTimerMetrics = [];
  for (key in timers) {
    if (timers[key].length > 0) {

      if (this.isBlacklisted(key)) {
        continue;
      }

      var values = timers[key].sort(function(a, b) {
        return a - b;
      });
      var count = values.length;
      var min = values[0];
      var max = values[count - 1];

      var cumulativeValues = [min];
      for (var i = 1; i < count; i++) {
        cumulativeValues.push(values[i] + cumulativeValues[i - 1]);
      }

      var sum = min;
      var mean = min;
      var maxAtThreshold = max;

      var message = "";

      var key2;

      sum = cumulativeValues[count - 1];
      mean = sum / count;

      var names = this.config.processKeyForNamespace ? this.processKey(key) : {};
      namespace = this.config.namespace || names.namespace || "AwsCloudWatchStatsdBackend";
      var metricName = this.config.metricName || names.metricName || key;

      var datum = {
        MetricName: this.getAlias(metricName),
        Unit: 'Milliseconds',
        Timestamp: new Date(timestamp * 1000).toISOString(),
        StatisticValues: {
          Minimum: min,
          Maximum: max,
          Sum: sum,
          SampleCount: count
        }
      };
      if (dimensions) {
        datum.Dimensions = dimensions;
      }
      currentTimerMetrics.push(datum);
    }
  }

  this.batchSend(currentTimerMetrics, namespace);

  // put all currently accumulated gauge metrics into an array
  var currentGaugeMetrics = [];
  for (key in gauges) {

    if (this.isBlacklisted(key)) {
      continue;
    }

    var names = this.config.processKeyForNamespace ? this.processKey(key) : {};
    namespace = this.config.namespace || names.namespace || "AwsCloudWatchStatsdBackend";
    var metricName = this.config.metricName || names.metricName || key;

    var datum = {
      MetricName: this.getAlias(metricName),
      Unit: 'None',
      Timestamp: new Date(timestamp * 1000).toISOString(),
      Value: gauges[key]
    };
    if (dimensions) {
      datum.Dimensions = dimensions;
    }
    currentGaugeMetrics.push(datum);
  }

  this.batchSend(currentGaugeMetrics, namespace);

  // put all currently accumulated set metrics into an array
  var currentSetMetrics = [];
  for (key in sets) {

    if (this.isBlacklisted(key)) {
      continue;
    }

    var names = this.config.processKeyForNamespace ? this.processKey(key) : {};
    namespace = this.config.namespace || names.namespace || "AwsCloudWatchStatsdBackend";
    var metricName = this.config.metricName || names.metricName || key;

    var datum = {
      MetricName: this.getAlias(metricName),
      Unit: 'None',
      Timestamp: new Date(timestamp * 1000).toISOString(),
      Value: sets[key].values().length
    };
    if (dimensions) {
      datum.Dimensions = dimensions;
    }
    currentSetMetrics.push(datum);
  }

  this.batchSend(currentSetMetrics, namespace);
};

exports.CloudwatchBackend = CloudwatchBackend;

exports.init = function(startupTime, config, events) {
  var cloudwatch = config.cloudwatch || {};
  var instances = cloudwatch.instances || [cloudwatch];
  for (key in instances) {
    instanceConfig = instances[key];
    console.log("Starting cloudwatch reporter instance in region:", instanceConfig.region);
    var instance = new CloudwatchBackend(startupTime, instanceConfig, events);
  }
  return true;
};
