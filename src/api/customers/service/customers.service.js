import { last, get, find, pipe } from 'lodash/fp';
import { ValidationError, ConcurrencyError } from '../../../errors';

export default function ({
  commercetools,
  customersSequence,
  customObjectsService,
  commonsService,
  syncCustomers,
  utils,
}) {
  const service = {};
  const { client, getRequestBuilder } = commercetools;

  const checkChangePasswordRequiredFields = (currentPassword, newPassword) => {
    if (utils.commons.isStringEmpty(currentPassword)) {
      throw new ValidationError('"current password" is required');
    }

    if (utils.commons.isStringEmpty(newPassword)) {
      throw new ValidationError('"new password" is required');
    }
  };

  service.setCustomerNumber = ({ sequence, value, version }) =>
    customObjectsService
      .save({
        container: sequence,
        key: sequence,
        value,
        version,
      })
      .then(customObject => customObject.value);

  service.getCustomerNumber = sequence =>
    customObjectsService
      .find({ where: `key="${sequence}"` })
      .then(({ results }) => (results.length > 0 ? results[0] : { value: 0 }))
      .then(lastValue =>
        service
          .setCustomerNumber({
            sequence,
            value: lastValue.value + 1,
            version: lastValue.version,
          })
          .catch(err => {
            if (err instanceof ConcurrencyError) {
              return service.getCustomerNumber(sequence); // We request a new one on error
            }

            throw new Error(err);
          }),
      );

  service.getCustomerVersion = (id, version) =>
    Promise.resolve().then(() => version || service.byId(id).then(customer => customer.version));

  service.signUp = customer =>
    service
      .getCustomerNumber(customersSequence)
      .then(customerNumber => ({ ...customer, customerNumber: customerNumber.toString() }))
      .then(utils.commons.fieldsToLowerCase)
      .then(commonsService.save);

  service.signIn = (email, password, anonymousCartId) =>
    client
      .execute({
        uri: `${getRequestBuilder().project.build()}login`,
        method: 'POST',
        body: { email, password, anonymousCartId },
      })
      .then(res => res.body.customer)
      .catch(err => {
        if (err.statusCode === 400) {
          return;
        }
        throw new Error(err);
      });

  service.update = (id, customerDraft, options = {}) =>
    service.byId(id).then(oldCustomer => {
      const newCustomer = {
        ...oldCustomer,
        ...utils.commons.fieldsToLowerCase(customerDraft),
      };
      const actions = syncCustomers.buildActions(newCustomer, oldCustomer);

      return commonsService.update({
        id: oldCustomer.id,
        actions,
        version: options.version || oldCustomer.version,
      });
    });

  service.byId = id => commonsService.byId(id);

  service.find = ({ where, page, perPage, sortBy, sortAscending, expand, authUser }) => {
    if (authUser) {
      if (authUser.isAdmin) {
        return commonsService.find({ where, page, perPage, sortBy, sortAscending, expand });
      } else {
        return commonsService.find({
          where: `${where} and id="${authUser.id}"`,
          page,
          perPage,
          sortBy,
          sortAscending,
          expand,
        });
      }
    } else {
      return Promise.reject(new Error('Not authorized'));
    }
  };

  service.changePassword = (id, currentPassword, newPassword, options = {}) =>
    Promise.resolve()
      .then(() => checkChangePasswordRequiredFields(currentPassword, newPassword))
      .then(() => service.getCustomerVersion(id, options.version))
      .then(customerVersion =>
        client.execute({
          uri: `${getRequestBuilder().customers.build()}/password`,
          method: 'POST',
          body: { id, version: customerVersion, currentPassword, newPassword },
        }),
      )
      .then(res => res.body);

  service.saveAddress = (id, addressDraft, options = {}) =>
    Promise.resolve()
      .then(() => utils.commons.checkIfAddressHasRequiredFields(addressDraft))
      .then(() => utils.commons.fieldsToLowerCase(addressDraft, { skip: ['country'] }))
      .then(addressDraftLowerCased =>
        commonsService.update({
          id,
          version: options.version,
          actions: [
            {
              action: addressDraft.id ? 'changeAddress' : 'addAddress',
              address: addressDraftLowerCased,
              addressId: addressDraft.id,
            },
          ],
        }),
      )
      .then(customer => {
        const address = addressDraft.id
          ? pipe(
              get('addresses'),
              find({ id: addressDraft.id }),
            )(customer)
          : pipe(
              get('addresses'),
              last,
            )(customer);
        const wasDefaultShipping = address.id === customer.defaultShippingAddressId;
        const wasDefaultBilling = address.id === customer.defaultBillingAddressId;

        if (
          addressDraft.isDefaultBilling ||
          addressDraft.isDefaultShipping ||
          wasDefaultShipping ||
          wasDefaultBilling
        ) {
          return service.setDefaultAddress(id, address.id, {
            version: customer.version,
            isDefaultShipping: addressDraft.isDefaultShipping,
            isDefaultBilling: addressDraft.isDefaultBilling,
            wasDefaultShipping,
            wasDefaultBilling,
          });
        }

        return customer;
      });

  service.setDefaultAddress = (id, addressId, options = {}) => {
    const actions = [];

    if (options.isDefaultShipping) {
      actions.push({
        action: 'setDefaultShippingAddress',
        addressId,
      });
    } else if (options.wasDefaultShipping) {
      actions.push({
        action: 'setDefaultShippingAddress',
      });
    }

    if (options.isDefaultBilling) {
      actions.push({
        action: 'setDefaultBillingAddress',
        addressId,
      });
    } else if (options.wasDefaultBilling) {
      actions.push({
        action: 'setDefaultBillingAddress',
      });
    }

    return commonsService.update({
      id,
      version: options.version,
      actions,
    });
  };

  service.removeAddress = (id, addressId, options = {}) =>
    commonsService.update({
      id,
      version: options.version,
      actions: [
        {
          action: 'removeAddress',
          addressId,
        },
      ],
    });

  return service;
}
